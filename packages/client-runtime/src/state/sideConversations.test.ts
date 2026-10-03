import { describe, expect, it } from "vite-plus/test";
import {
  CheckpointId,
  ContextTransferId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2ContextTransfer,
  type OrchestrationV2Run,
} from "@t3tools/contracts";

import { v2Now, v2Projection } from "./orchestrationV2TestFixtures.ts";
import type { EnvironmentThreadShell } from "./models.ts";
import {
  latestStableSideConversationRun,
  sideConversationContextLabel,
  sideConversationsForThread,
  visibleMainConversationThreads,
} from "./sideConversations.ts";

const environmentId = EnvironmentId.make("environment:side");
const otherEnvironmentId = EnvironmentId.make("environment:other");
const parentId = ThreadId.make("thread:parent");
const projectId = ProjectId.make("project:side");
type TestThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "presentation" | "deletedAt"
>;
const parent: TestThread = { environmentId, id: parentId, projectId, deletedAt: null };
const side: TestThread = {
  ...parent,
  id: ThreadId.make("thread:side"),
  presentation: { kind: "side", ownerThreadId: parentId },
};

function run(ordinal: number, status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return {
    id: RunId.make(`run:${ordinal}`),
    threadId: parentId,
    ordinal,
    providerInstanceId: v2Projection.thread.providerInstanceId,
    modelSelection: v2Projection.thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    queuePosition: null,
    requestedAt: v2Now,
    startedAt: v2Now,
    completedAt: status === "completed" ? v2Now : null,
    checkpointId: status === "completed" ? CheckpointId.make(`checkpoint:${ordinal}`) : null,
    contextHandoffId: null,
  };
}

describe("side conversations", () => {
  it("keeps owned children out of the main list and exposes orphans and promoted children", () => {
    const orphan: TestThread = {
      ...side,
      id: ThreadId.make("thread:orphan"),
      presentation: { kind: "side", ownerThreadId: ThreadId.make("thread:missing") },
    };
    const otherEnvironment = { ...side, environmentId: otherEnvironmentId };
    const otherProject = { ...side, projectId: ProjectId.make("project:other") };
    const deleted = { ...side, id: ThreadId.make("thread:deleted"), deletedAt: "2026-10-03" };
    const promoted: TestThread = {
      ...side,
      id: ThreadId.make("thread:promoted"),
      presentation: { kind: "standard" },
    };
    const threads = [parent, side, orphan, otherEnvironment, otherProject, deleted, promoted];
    expect(visibleMainConversationThreads(threads)).toEqual([
      parent,
      orphan,
      otherEnvironment,
      otherProject,
      promoted,
    ]);
    expect(sideConversationsForThread(threads, { environmentId, threadId: parentId })).toEqual([
      side,
    ]);
    expect(visibleMainConversationThreads([{ ...parent, deletedAt: "2026-10-03" }, side])).toEqual([
      side,
    ]);
  });

  it("uses the previous completed checkpoint while the next parent turn is running", () => {
    const completed = run(1, "completed");
    const active = run(2, "running");
    expect(latestStableSideConversationRun({ runs: [active, completed] })).toBe(completed);
    expect(latestStableSideConversationRun({ runs: [active] })).toBeNull();
    expect(
      latestStableSideConversationRun({ runs: [{ ...completed, checkpointId: null }, active] }),
    ).toBeNull();
  });

  it("describes the resolved context strategy instead of promising a native clone", () => {
    const transfer: OrchestrationV2ContextTransfer = {
      id: ContextTransferId.make("transfer:side"),
      type: "fork",
      sourceThreadId: parentId,
      targetThreadId: side.id,
      sourcePoint: { threadId: parentId, runId: RunId.make("run:1") },
      basePoint: null,
      sourceProviderInstanceId: null,
      targetProviderInstanceId: null,
      targetRunId: null,
      status: "pending",
      resolution: null,
      error: null,
      createdBy: "user",
      createdAt: v2Now,
      updatedAt: v2Now,
      consumedAt: null,
    };
    expect(sideConversationContextLabel({ contextTransfers: [transfer] })).toBe(
      "Context from the last completed turn",
    );
    expect(
      sideConversationContextLabel({
        contextTransfers: [
          {
            ...transfer,
            status: "resolved_native",
            resolution: {
              strategy: "native_fork",
              providerThreadRef: {
                driver: ProviderDriverKind.make("codex"),
                nativeId: "native-side",
                strength: "strong",
              },
            },
          },
        ],
      }),
    ).toBe("Native provider fork");
  });
});
