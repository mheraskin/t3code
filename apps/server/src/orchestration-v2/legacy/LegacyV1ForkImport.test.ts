import { assert, describe, it } from "@effect/vitest";
import {
  ChatAttachment,
  ChatImageAttachment,
  EventId,
  MessageId,
  OrchestrationV2LegacyForkOrigin,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionMaintenance from "../ProjectionMaintenance.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as LegacyV1ThreadImporter from "./LegacyV1ThreadImporter.ts";

const stores = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  EventStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
);
const eventSink = EventSink.layer.pipe(Layer.provide(stores));
const TestLayer = Layer.mergeAll(
  stores,
  eventSink,
  LegacyV1ThreadImporter.layer.pipe(Layer.provide(Layer.mergeAll(stores, eventSink))),
  ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
);

const source = (sourceThreadId: string, sourceMessageId: string | null = null) => ({
  sourceThreadId: ThreadId.make(sourceThreadId),
  sourceTurnId: null,
  sourceMessageId: sourceMessageId === null ? null : MessageId.make(sourceMessageId),
  forkedAt: "2026-01-03T00:00:00.000Z",
});
const encodeFork = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2LegacyForkOrigin));
const encodeAttachments = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ChatAttachment)));
const encodeInvalidFork = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN fork_json TEXT`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN side_chat INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN parent_thread_id TEXT`;
  yield* sql`
    INSERT INTO projection_projects
      (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES
      ('project:a', 'A', '/tmp/a', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('project:b', 'B', '/tmp/b', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `;
});

const insertThread = Effect.fnUntraced(function* (input: {
  readonly id: string;
  readonly projectId?: string;
  readonly forkJson?: string;
  readonly sideChat?: boolean;
  readonly filedUnder?: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads
      (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
       created_at, updated_at, fork_json, side_chat, parent_thread_id)
    VALUES
      (${input.id}, ${input.projectId ?? "project:a"}, ${input.id},
       '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default',
       '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z',
       ${input.forkJson ?? null}, ${input.sideChat ? 1 : 0}, ${input.filedUnder ?? null})
  `;
});

describe("legacy fork import", () => {
  it.effect(
    "preserves side presentation, causal ancestry, independent filing and attachments",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        yield* seed;
        yield* insertThread({ id: "parent" });
        yield* insertThread({ id: "filed-parent" });
        const origin = source("parent", "parent-message");
        yield* insertThread({
          id: "side",
          forkJson: encodeFork(origin),
          sideChat: true,
          filedUnder: "filed-parent",
        });
        yield* insertThread({
          id: "nested-side",
          forkJson: encodeFork({ ...source("side"), sourceHead: true }),
          sideChat: true,
        });
        const attachment = ChatImageAttachment.make({
          type: "image",
          id: "att-1",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 1234,
        });
        yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at)
        VALUES
          ('parent-message', 'parent', 'assistant', 'Source answer', '[]', 0,
           '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
          ('side-first', 'side', 'user', 'First question', ${encodeAttachments([attachment])}, 0,
           '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
          ('side-next', 'side', 'user', 'Follow-up', '[]', 0,
           '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
          ('side-last', 'side', 'assistant', 'Partial response', '[]', 1,
           '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')
      `;
        assert.equal((yield* importer.reconcileShells).importedThreadCount, 4);
        const side = yield* projections.getThreadProjection(ThreadId.make("side"));
        assert.deepStrictEqual(side.thread.presentation, {
          kind: "side",
          ownerThreadId: ThreadId.make("parent"),
        });
        assert.equal(side.thread.filedUnderThreadId, "filed-parent");
        assert.deepStrictEqual(side.thread.legacyFork, origin);
        assert.deepStrictEqual(side.thread.lineage, {
          parentThreadId: ThreadId.make("parent"),
          relationshipToParent: "fork",
          rootThreadId: ThreadId.make("parent"),
        });
        assert.isNull(side.thread.forkedFrom);
        assert.isEmpty(side.runs);
        assert.isEmpty(side.contextTransfers);
        const nested = yield* projections.getThreadProjection(ThreadId.make("nested-side"));
        assert.equal(nested.thread.lineage.rootThreadId, "parent");
        assert.equal(nested.thread.lineage.parentThreadId, "side");
        assert.isTrue(nested.thread.legacyFork?.sourceHead);
        yield* importer.ensureTranscript(ThreadId.make("side"));
        const hydrated = yield* projections.getThreadProjection(ThreadId.make("side"));
        assert.deepStrictEqual(
          hydrated.messages.map((message) => message.text),
          ["First question", "Follow-up", "Partial response"],
        );
        assert.deepStrictEqual(hydrated.messages[0]?.attachments, [attachment]);
        assert.isFalse(hydrated.messages[2]?.streaming);
        assert.isTrue((yield* maintenance.rebuild).valid);
        const replayed = yield* projections.getThreadProjection(ThreadId.make("side"));
        assert.deepStrictEqual(replayed.thread, hydrated.thread);
        assert.deepStrictEqual(yield* importer.reconcileShells, {
          importedThreadCount: 0,
          importedMessageCount: 0,
        });
      }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps invalid and orphan forks visible without inventing ancestry", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* seed;
      yield* insertThread({ id: "parent" });
      yield* insertThread({ id: "other", projectId: "project:b" });
      yield* insertThread({ id: "malformed", forkJson: "{broken", sideChat: true });
      yield* insertThread({
        id: "invalid-schema",
        forkJson: encodeInvalidFork({ ...source("parent"), sourceHead: false }),
        sideChat: true,
      });
      yield* insertThread({
        id: "orphan",
        forkJson: encodeFork(source("missing")),
        sideChat: true,
      });
      yield* insertThread({
        id: "cross-project",
        forkJson: encodeFork(source("other")),
        sideChat: true,
        filedUnder: "other",
      });
      yield* insertThread({
        id: "mismatched-message",
        forkJson: encodeFork(source("parent", "other-message")),
        sideChat: true,
      });
      yield* insertThread({
        id: "mismatched-turn",
        forkJson: encodeFork({ ...source("parent"), sourceTurnId: TurnId.make("other-turn") }),
        sideChat: true,
      });
      yield* insertThread({
        id: "shared-turn",
        forkJson: encodeFork({ ...source("parent"), sourceTurnId: TurnId.make("shared-turn-id") }),
        sideChat: true,
      });
      yield* sql`
        INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, checkpoint_files_json)
        VALUES
          ('other', 'other-turn', 'completed', '2026-01-02T00:00:00.000Z', '[]'),
          ('other', 'shared-turn-id', 'completed', '2026-01-02T00:00:00.000Z', '[]'),
          ('parent', 'shared-turn-id', 'completed', '2026-01-02T00:00:00.000Z', '[]')
      `;
      yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at)
        VALUES ('other-message', 'other', 'assistant', 'Other context', '[]', 0,
                '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
      `;
      yield* insertThread({
        id: "cycle-a",
        forkJson: encodeFork(source("cycle-b")),
        sideChat: true,
        filedUnder: "cycle-b",
      });
      yield* insertThread({
        id: "cycle-b",
        forkJson: encodeFork(source("cycle-a")),
        sideChat: true,
        filedUnder: "cycle-a",
      });
      yield* importer.reconcileShells;
      for (const id of [
        "malformed",
        "invalid-schema",
        "orphan",
        "cross-project",
        "mismatched-message",
        "mismatched-turn",
        "cycle-a",
        "cycle-b",
      ]) {
        const projection = yield* projections.getThreadProjection(ThreadId.make(id));
        assert.deepStrictEqual(projection.thread.presentation, { kind: "standard" });
        assert.deepStrictEqual(projection.thread.lineage, {
          parentThreadId: null,
          relationshipToParent: null,
          rootThreadId: ThreadId.make(id),
        });
        assert.isNull(projection.thread.filedUnderThreadId);
        assert.isEmpty(projection.runs);
        assert.isEmpty(projection.contextTransfers);
      }
      assert.isUndefined(
        (yield* projections.getThreadProjection(ThreadId.make("malformed"))).thread.legacyFork,
      );
      assert.equal(
        (yield* projections.getThreadProjection(ThreadId.make("orphan"))).thread.legacyFork
          ?.sourceThreadId,
        "missing",
      );
      assert.deepStrictEqual(
        (yield* projections.getThreadProjection(ThreadId.make("shared-turn"))).thread.presentation,
        { kind: "side", ownerThreadId: ThreadId.make("parent") },
      );
      assert.deepStrictEqual(yield* importer.reconcileShells, {
        importedThreadCount: 0,
        importedMessageCount: 0,
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "repairs older imported shells once while preserving subsequent promotion and metadata changes",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const sink = yield* EventSink.EventSinkV2;
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        yield* seed;
        yield* insertThread({ id: "parent" });
        yield* insertThread({
          id: "side",
          forkJson: encodeFork(source("parent")),
          sideChat: true,
          filedUnder: "parent",
        });
        yield* importer.reconcileShells;
        yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(
          json_remove(payload_json, '$.presentation', '$.filedUnderThreadId', '$.legacyFork'),
          '$.lineage', json('{"parentThreadId":null,"relationshipToParent":null,"rootThreadId":"side"}')
        ) WHERE thread_id = 'side'
      `;
        assert.equal((yield* importer.reconcileShells).importedThreadCount, 1);
        const repaired = yield* projections.getThreadProjection(ThreadId.make("side"));
        assert.deepStrictEqual(repaired.thread.presentation, {
          kind: "side",
          ownerThreadId: ThreadId.make("parent"),
        });
        assert.equal(repaired.thread.lineage.rootThreadId, "parent");
        const changed = {
          ...repaired.thread,
          presentation: { kind: "standard" as const },
          filedUnderThreadId: null,
          title: "Promoted and renamed",
          runtimeMode: "approval-required" as const,
          archivedAt: DateTime.makeUnsafe("2026-02-01T00:00:00.000Z"),
        };
        yield* sink.write({
          events: [
            {
              id: EventId.make("user:promote:side"),
              type: "thread.metadata-updated",
              threadId: changed.id,
              providerInstanceId: changed.providerInstanceId,
              occurredAt: changed.archivedAt,
              payload: changed,
            },
          ],
        });
        yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET payload_json = json_remove(payload_json, '$.activeOrderKey')
        WHERE thread_id = 'side'
      `;
        assert.equal((yield* importer.reconcileShells).importedThreadCount, 1);
        const promoted = yield* projections.getThreadProjection(ThreadId.make("side"));
        assert.equal(promoted.thread.title, changed.title);
        assert.equal(promoted.thread.runtimeMode, changed.runtimeMode);
        assert.deepStrictEqual(promoted.thread.presentation, { kind: "standard" });
        assert.isNull(promoted.thread.filedUnderThreadId);
        assert.deepStrictEqual(promoted.thread.archivedAt, changed.archivedAt);
        assert.deepStrictEqual(promoted.thread.lineage, changed.lineage);
        assert.deepStrictEqual(yield* importer.reconcileShells, {
          importedThreadCount: 0,
          importedMessageCount: 0,
        });
        assert.isTrue((yield* maintenance.rebuild).valid);
        assert.deepStrictEqual(
          (yield* projections.getThreadProjection(ThreadId.make("side"))).thread,
          promoted.thread,
        );
        assert.deepStrictEqual(
          yield* Effect.gen(function* () {
            const restarted = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
            return yield* restarted.reconcileShells;
          }).pipe(Effect.provide(LegacyV1ThreadImporter.layer)),
          { importedThreadCount: 0, importedMessageCount: 0 },
        );
      }).pipe(Effect.provide(TestLayer)),
  );
});
