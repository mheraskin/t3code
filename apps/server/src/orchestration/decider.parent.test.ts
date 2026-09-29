import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PARENT = ThreadId.make("parent");
const CHILD = ThreadId.make("child");
const OTHER = ThreadId.make("other");

function makeThread(
  id: ThreadId,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread {
  return {
    id,
    projectId: ProjectId.make("project-1"),
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    activeOrderKey: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeReadModel(threads: OrchestrationThread[]): OrchestrationReadModel {
  return { snapshotSequence: 0, projects: [], threads, updatedAt: NOW };
}

const setParent = (threadId: ThreadId, parentThreadId: ThreadId | null) =>
  ({
    type: "thread.parent.set",
    commandId: CommandId.make(`cmd-${threadId}-${parentThreadId}`),
    threadId,
    parentThreadId,
  }) as const;

it.layer(NodeServices.layer)("thread parenting", (it) => {
  it.effect("files a thread under a parent and back out without touching activity", () =>
    Effect.gen(function* () {
      let readModel = makeReadModel([makeThread(PARENT), makeThread(CHILD)]);
      for (const parentThreadId of [PARENT, null]) {
        const decided = yield* decideOrchestrationCommand({
          command: setParent(CHILD, parentThreadId),
          readModel,
        });
        const events = Array.isArray(decided) ? decided : [decided];
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: "thread.meta-updated",
          payload: { threadId: CHILD, parentThreadId, updatedAt: NOW },
        });
        readModel = yield* projectEvent(readModel, {
          ...events[0]!,
          sequence: readModel.snapshotSequence + 1,
        });
        expect(readModel.threads.find((thread) => thread.id === CHILD)?.parentThreadId).toBe(
          parentThreadId,
        );
      }
    }),
  );

  it.effect("keeps sub-threads one level deep", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel([
        makeThread(PARENT),
        makeThread(CHILD, { parentThreadId: PARENT }),
        makeThread(OTHER),
      ]);
      const reject = (threadId: ThreadId, parentThreadId: ThreadId) =>
        decideOrchestrationCommand({
          command: setParent(threadId, parentThreadId),
          readModel,
        }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        );
      // Under a sub-thread, a parent under anything, and itself.
      expect(yield* reject(OTHER, CHILD)).toBe("OrchestrationCommandInvariantError");
      expect(yield* reject(PARENT, OTHER)).toBe("OrchestrationCommandInvariantError");
      expect(yield* reject(OTHER, OTHER)).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a deleted parent", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel([makeThread(PARENT, { deletedAt: NOW }), makeThread(CHILD)]);
      const error = yield* decideOrchestrationCommand({
        command: setParent(CHILD, PARENT),
        readModel,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
