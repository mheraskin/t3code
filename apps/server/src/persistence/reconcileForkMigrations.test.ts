import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const seedFork = Effect.fnUntraced(function* (forkId: 48 | 55, withFiling = false) {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: forkId - 1 });
  yield* sql`ALTER TABLE projection_threads ADD COLUMN fork_json TEXT`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN side_chat INTEGER NOT NULL DEFAULT 0`;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name, created_at)
    VALUES (${forkId}, 'ProjectionThreadForks', '2026-08-01 00:00:00')
  `;
  if (withFiling) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN parent_thread_id TEXT`;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES (56, 'ProjectionThreadsParentThreadId')
    `;
  }
});

describe("fork migration reconciliation", () => {
  it.effect.each([false, true])(
    "creates V2 on a fork database and preserves provenance with filing %s",
    (withFiling) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedFork(55, withFiling);
        const history = yield* sql`
          SELECT migration_id, name, created_at FROM effect_sql_migrations WHERE migration_id >= 55
        `;
        assert.deepStrictEqual(yield* runMigrations(), [
          [55, "OrchestrationV2"],
          [56, "RemoveRedundantProjectionIndexes"],
        ]);
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM t3_fork_migration_history ORDER BY migration_id`,
          history,
        );
        assert.lengthOf(
          yield* sql`SELECT name FROM sqlite_master WHERE name = 'orchestration_v2_legacy_imports'`,
          1,
        );
        yield* sql`
          INSERT INTO orchestration_v2_legacy_imports
            (thread_id, source_updated_at, shell_imported_at, imported_message_count)
          VALUES ('preserved', '2026-09-01', '2026-09-01', 7)
        `;
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepStrictEqual(
          yield* sql`SELECT thread_id, imported_message_count FROM orchestration_v2_legacy_imports`,
          [{ thread_id: "preserved", imported_message_count: 7 }],
        );
        const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
        `;
        assert.deepStrictEqual(
          ledger.map((row) => [row.migration_id, row.name] as const),
          migrationManifest,
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("repairs the original fork at 48 before running the later upstream migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedFork(48);
      const applied = yield* runMigrations();
      assert.deepStrictEqual(
        applied.map(([id]) => id),
        [48, 49, 50, 51, 52, 53, 54, 55, 56],
      );
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      assert.ok(columns.some((column) => column.name === "branch_pull_request_json"));
      assert.deepStrictEqual(yield* sql`SELECT migration_id, name FROM t3_fork_migration_history`, [
        { migration_id: 48, name: "ProjectionThreadForks" },
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back V2 schema and provenance together and retries after failure", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedFork(55, true);
      const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      yield* sql`
        CREATE TRIGGER fail_fork_upgrade BEFORE UPDATE ON effect_sql_migrations
        WHEN NEW.name = 'OrchestrationV2'
        BEGIN SELECT RAISE(ABORT, 'injected failure'); END
      `;
      assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        history,
      );
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name IN ('orchestration_v2_legacy_imports', 't3_fork_migration_history')`,
        [],
      );
      yield* sql`DROP TRIGGER fail_fork_upgrade`;
      assert.deepStrictEqual(yield* runMigrations(), [
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("reports invalid project JSON as a migration failure and retries after repair", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedFork(55);
      yield* sql`
        INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('invalid-json', 'Project', '/tmp/project', '{broken', '2026-09-01', '2026-09-01')
      `;
      const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const error = yield* Effect.flip(runMigrations());
      assert.instanceOf(error, Migrator.MigrationError);
      assert.deepInclude(error, {
        kind: "Failed",
        message: 'Migration "55_OrchestrationV2" failed',
      });
      if (error._tag === "MigrationError") {
        assert.instanceOf(error.cause, Schema.SchemaError);
      }
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        history,
      );
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name IN ('orchestration_v2_legacy_imports', 't3_fork_migration_history')`,
        [],
      );
      yield* sql`UPDATE projection_projects SET scripts_json = '[]' WHERE project_id = 'invalid-json'`;
      assert.deepStrictEqual(yield* runMigrations(), [
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each(["schema", "history", "existing-v2"])(
    "rejects an ambiguous recognized fork %s without modifying its ledger",
    (invalid) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedFork(55);
        if (invalid === "schema") {
          yield* sql`ALTER TABLE projection_threads DROP COLUMN side_chat`;
        } else if (invalid === "history") {
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name) VALUES (56, 'UnknownFork')
          `;
        } else {
          yield* sql`CREATE TABLE orchestration_v2_unknown (id TEXT)`;
        }
        const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          history,
        );
        assert.deepStrictEqual(
          yield* sql`SELECT name FROM sqlite_master WHERE name = 't3_fork_migration_history'`,
          [],
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves a normal upstream database without a fork ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name = 't3_fork_migration_history'`,
        [],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
