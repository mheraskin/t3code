import type {
  EnvironmentId,
  OrchestrationV2AppThread,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import type { EnvironmentThreadShell } from "./models.ts";

type SideConversationThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "presentation" | "deletedAt"
>;

export function isSideConversation(
  thread: Pick<OrchestrationV2AppThread, "presentation">,
): boolean {
  return thread.presentation?.kind === "side";
}

export function sideConversationOwnerThreadId(
  thread: Pick<OrchestrationV2AppThread, "presentation">,
): ThreadId | null {
  return thread.presentation?.kind === "side" ? thread.presentation.ownerThreadId : null;
}

export function sideConversationsForThread<T extends SideConversationThread>(
  threads: ReadonlyArray<T>,
  ownerRef: ScopedThreadRef,
): T[] {
  const owner = threads.find(
    (thread) => thread.environmentId === ownerRef.environmentId && thread.id === ownerRef.threadId,
  );
  return threads.filter(
    (thread) =>
      thread.environmentId === ownerRef.environmentId &&
      thread.id !== ownerRef.threadId &&
      thread.deletedAt === null &&
      (owner === undefined || thread.projectId === owner.projectId) &&
      sideConversationOwnerThreadId(thread) === ownerRef.threadId,
  );
}

/** Orphaned side conversations stay reachable when their owner is absent. */
export function visibleMainConversationThreads<T extends SideConversationThread>(
  threads: ReadonlyArray<T>,
): T[] {
  const byEnvironment = new Map<EnvironmentId, Map<ThreadId, T>>();
  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    let byId = byEnvironment.get(thread.environmentId);
    if (byId === undefined) {
      byId = new Map();
      byEnvironment.set(thread.environmentId, byId);
    }
    byId.set(thread.id, thread);
  }
  return threads.filter((thread) => {
    if (thread.deletedAt !== null) return false;
    const ownerId = sideConversationOwnerThreadId(thread);
    if (ownerId === null || ownerId === thread.id) return true;
    const owner = byEnvironment.get(thread.environmentId)?.get(ownerId);
    return owner === undefined || owner.projectId !== thread.projectId;
  });
}

export function latestStableSideConversationRun(
  projection: Pick<OrchestrationV2ThreadProjection, "runs"> | null | undefined,
): OrchestrationV2Run | null {
  let latest: OrchestrationV2Run | null = null;
  for (const run of projection?.runs ?? []) {
    if (
      run.status === "completed" &&
      run.checkpointId !== null &&
      (latest === null || run.ordinal > latest.ordinal)
    ) {
      latest = run;
    }
  }
  return latest;
}

export function sideConversationContextLabel(
  projection: Pick<OrchestrationV2ThreadProjection, "contextTransfers"> | null | undefined,
): string {
  if (projection == null) return "Loading conversation context";
  const transfers = projection.contextTransfers;
  for (let index = transfers.length - 1; index >= 0; index--) {
    const transfer = transfers[index];
    if (transfer?.type !== "fork") continue;
    if (transfer.status === "failed") return "Conversation context could not be transferred";
    if (transfer.resolution?.strategy === "native_fork") return "Native provider fork";
    if (transfer.resolution !== null) return "Portable conversation context";
    return "Context from the last completed turn";
  }
  return "Imported conversation history";
}
