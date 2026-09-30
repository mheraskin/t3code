import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type ServerConfig,
  type ServerProviderSessionFork,
  type ThreadId,
  type TurnId,
  threadProviderInstanceId,
} from "@t3tools/contracts";

export function visibleTopLevelThreads<
  T extends Pick<EnvironmentThreadShell, "fork" | "id" | "sideChat">,
>(threads: ReadonlyArray<T>, knownThreadIds: ReadonlySet<ThreadId>): T[] {
  return threads.filter((thread) => {
    const sourceThreadId = thread.fork?.sourceThreadId;
    return (
      thread.sideChat !== true ||
      sourceThreadId === undefined ||
      !knownThreadIds.has(sourceThreadId)
    );
  });
}

/** The capability lookup reads nothing but each provider's id and fork support. */
export interface ForkCapabilityConfig {
  readonly providers: ReadonlyArray<
    Pick<ServerConfig["providers"][number], "instanceId" | "sessionFork">
  >;
}

export function resolveMobileThreadForkCapability(
  thread: Pick<EnvironmentThreadShell, "modelSelection" | "session">,
  serverConfig: ForkCapabilityConfig | null,
): ServerProviderSessionFork | undefined {
  const instanceId = threadProviderInstanceId(thread);
  return serverConfig?.providers.find((provider) => provider.instanceId === instanceId)
    ?.sessionFork;
}

export function resolveMobileLatestCompletedTurnId(
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "state" | "completedAt"> | null | undefined,
): TurnId | null {
  return latestTurn?.state === "completed" && latestTurn.completedAt !== null
    ? latestTurn.turnId
    : null;
}

export function completedTurnIdsFromCheckpoints(
  checkpoints: ReadonlyArray<Pick<OrchestrationCheckpointSummary, "status" | "turnId">>,
): ReadonlySet<TurnId> {
  return new Set(
    checkpoints
      .filter((checkpoint) => checkpoint.status === "ready")
      .map((checkpoint) => checkpoint.turnId),
  );
}

export function canForkMobileAssistantMessage(input: {
  readonly capability: ServerProviderSessionFork | undefined;
  readonly completed: boolean;
  readonly completedTurnIds: ReadonlySet<TurnId>;
  readonly messageTurnId: TurnId | null;
  readonly latestTurn:
    | Pick<OrchestrationLatestTurn, "turnId" | "state" | "completedAt">
    | null
    | undefined;
}): boolean {
  if (!input.completed || input.messageTurnId === null) return false;
  if (
    input.latestTurn?.turnId === input.messageTurnId &&
    resolveMobileLatestCompletedTurnId(input.latestTurn) !== input.messageTurnId
  ) {
    return false;
  }
  const latestCompletedTurnId = resolveMobileLatestCompletedTurnId(input.latestTurn);
  if (input.capability === "any-turn") {
    // The latest completed turn is forkable as soon as it completes; older
    // turns need a ready checkpoint to prove they finished, same as web.
    return (
      input.messageTurnId === latestCompletedTurnId ||
      input.completedTurnIds.has(input.messageTurnId)
    );
  }
  return input.capability === "latest-turn" && input.messageTurnId === latestCompletedTurnId;
}

/** Pick the same completed response that the side-chat action can fork. */
export function resolveMobileSideChatTarget(input: {
  readonly capability: ServerProviderSessionFork | undefined;
  readonly latestTurn: OrchestrationLatestTurn | null | undefined;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationMessage, "id" | "role" | "streaming" | "turnId">
  >;
  readonly completedTurnIds: ReadonlySet<TurnId>;
}) {
  if (input.capability === undefined || input.capability === "unsupported") return null;
  const latest = input.latestTurn;
  if (resolveMobileLatestCompletedTurnId(latest) && latest?.assistantMessageId) {
    return { turnId: latest.turnId, messageId: latest.assistantMessageId };
  }
  if (input.capability !== "any-turn" || !latest || latest.state === "completed") return null;
  const message = input.messages.findLast(
    (candidate) =>
      candidate.role === "assistant" &&
      !candidate.streaming &&
      canForkMobileAssistantMessage({
        ...input,
        completed: true,
        messageTurnId: candidate.turnId,
      }),
  );
  return message?.turnId ? { turnId: message.turnId, messageId: message.id } : null;
}

export interface MobileSideChatMenuItem {
  readonly id: `side-chat:${ThreadId}`;
  readonly title: string;
}

export function buildMobileSideChatMenuItems(input: {
  readonly sideChats: ReadonlyArray<Pick<EnvironmentThreadShell, "id" | "title">>;
}): MobileSideChatMenuItem[] {
  return input.sideChats.map((sideChat) => ({
    id: `side-chat:${sideChat.id}`,
    title: sideChat.title,
  }));
}
