import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import BranchPullRequest from "./Migrations/048_ProjectionThreadBranchPullRequest.ts";
import OrchestrationV2 from "./Migrations/055_OrchestrationV2.ts";
import RemoveRedundantProjectionIndexes from "./Migrations/056_RemoveRedundantProjectionIndexes.ts";

const replacements = [
  [48, "ProjectionThreadForks", "ProjectionThreadBranchPullRequest", BranchPullRequest],
  [55, "ProjectionThreadForks", "OrchestrationV2", OrchestrationV2],
  [
    56,
    "ProjectionThreadsParentThreadId",
    "RemoveRedundantProjectionIndexes",
    RemoveRedundantProjectionIndexes,
  ],
] as const;

export const reconcileForkMigrations = Effect.fn("reconcileForkMigrations")(function* (
  manifest: ReadonlyArray<readonly [number, string]>,
  throughId?: number,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;
      if (!tables.some((table) => table.name === "effect_sql_migrations")) return [];
      const history = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
        readonly created_at: string;
      }>`SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id`;
      const collisions = replacements.flatMap((replacement) => {
        const row = history.find(
          (entry) => entry.migration_id === replacement[0] && entry.name === replacement[1],
        );
        return row === undefined ? [] : [{ row, replacement }];
      });
      if (collisions.length === 0) return [];
      if (
        collisions.some(({ replacement }) => replacement[0] === 56) &&
        !history.some(
          (row) =>
            row.migration_id === 55 &&
            (row.name === "ProjectionThreadForks" || row.name === "OrchestrationV2"),
        )
      ) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot reconcile fork migration 56 without its expected migration 55.",
        });
      }
      const firstCollisionId = collisions[0]?.row.migration_id ?? 48;
      const expected = new Map(manifest);
      if (
        history.some(
          (row) =>
            row.migration_id >= firstCollisionId &&
            row.name !== expected.get(row.migration_id) &&
            !collisions.some((collision) => collision.row === row),
        )
      ) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot reconcile fork migrations with unexpected later migration history.",
        });
      }
      const columns = yield* sql<{
        readonly name: string;
        readonly type: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(projection_threads)`;
      for (const { replacement } of collisions) {
        const required =
          replacement[1] === "ProjectionThreadForks"
            ? [
                { name: "fork_json", type: "TEXT", notnull: 0, dflt_value: null },
                { name: "side_chat", type: "INTEGER", notnull: 1, dflt_value: "0" },
              ]
            : [{ name: "parent_thread_id", type: "TEXT", notnull: 0, dflt_value: null }];
        if (
          required.some(
            (signature) =>
              !columns.some(
                (column) =>
                  column.name === signature.name &&
                  column.type.toUpperCase() === signature.type &&
                  column.notnull === signature.notnull &&
                  column.dflt_value === signature.dflt_value,
              ),
          )
        ) {
          return yield* new Migrator.MigrationError({
            kind: "BadState",
            message: `Cannot reconcile fork migration ${replacement[0]}: its schema does not match the known fork.`,
          });
        }
      }
      const eligible = collisions.filter(
        ({ replacement }) => throughId === undefined || replacement[0] <= throughId,
      );
      if (eligible.length === 0) return [];
      if (
        eligible.some(({ replacement }) => replacement[0] === 55) &&
        tables.some((table) => table.name.startsWith("orchestration_v2_"))
      ) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot reconcile fork migration 55 over an unrecorded existing V2 schema.",
        });
      }
      // Keep the original ledger outside the upstream id sequence so it cannot
      // advance the migrator past future upstream migrations.
      yield* sql`
        CREATE TABLE IF NOT EXISTS t3_fork_migration_history (
          migration_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (migration_id, name)
        )
      `;
      const executed: Array<readonly [number, string]> = [];
      for (const { row, replacement } of eligible) {
        yield* sql`
          INSERT INTO t3_fork_migration_history (migration_id, name, created_at)
          VALUES (${row.migration_id}, ${row.name}, ${row.created_at})
          ON CONFLICT (migration_id, name) DO NOTHING
        `;
        yield* replacement[3];
        yield* sql`
          UPDATE effect_sql_migrations SET name = ${replacement[2]}
          WHERE migration_id = ${row.migration_id} AND name = ${row.name}
        `;
        executed.push([replacement[0], replacement[2]]);
      }
      return executed;
    }),
  );
});
