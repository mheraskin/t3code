import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

import {
  canForkCompletedAssistantMessage,
  completedTurnIdsFromCheckpoints,
  resolveForkEntryAvailability,
  runCloseSideChat,
  runPromoteSideChat,
} from "./threadForking.logic";

const completedTurn = {
  turnId: TurnId.make("turn-2"),
  state: "completed" as const,
  requestedAt: "2026-09-03T12:00:00.000Z",
  startedAt: "2026-09-03T12:00:01.000Z",
  completedAt: "2026-09-03T12:00:02.000Z",
  assistantMessageId: MessageId.make("message-2"),
};

describe("thread fork entry availability", () => {
  it.each(["running", "interrupted", "error", "completed"] as const)(
    "forks the current progress of a live-fork provider whose latest turn is %s",
    (state) => {
      expect(
        resolveForkEntryAvailability({
          capability: "latest-turn",
          liveFork: true,
          latestTurn: {
            ...completedTurn,
            state,
            completedAt: state === "completed" ? completedTurn.completedAt : null,
          },
        }),
      ).toEqual({ enabled: true, target: { sourceHead: true }, disabledReason: null });
    },
  );

  it("does not offer a current-progress fork before the source has started", () => {
    expect(
      resolveForkEntryAvailability({ capability: "any-turn", liveFork: true, latestTurn: null }),
    ).toMatchObject({ enabled: false, disabledReason: "Start this conversation before forking." });
  });

  it("treats missing and unsupported provider capabilities as unavailable", () => {
    expect(
      resolveForkEntryAvailability({ capability: undefined, latestTurn: completedTurn }),
    ).toMatchObject({
      enabled: false,
    });
    expect(
      resolveForkEntryAvailability({ capability: "unsupported", latestTurn: completedTurn }),
    ).toMatchObject({ enabled: false });
  });

  it("requires a completed turn for header, palette, and keybinding entry points", () => {
    expect(
      resolveForkEntryAvailability({
        capability: "latest-turn",
        latestTurn: { ...completedTurn, state: "running", completedAt: null },
      }),
    ).toMatchObject({ enabled: false, target: null });
    expect(
      resolveForkEntryAvailability({ capability: "latest-turn", latestTurn: completedTurn }),
    ).toEqual({
      enabled: true,
      target: { turnId: completedTurn.turnId, messageId: completedTurn.assistantMessageId },
      disabledReason: null,
    });
  });

  it.each(["running", "interrupted", "error"] as const)(
    "uses the latest completed assistant response when an any-turn provider's latest turn is %s",
    (state) => {
      const previousTurnId = TurnId.make("turn-1");
      const previousMessageId = MessageId.make("message-1");

      expect(
        resolveForkEntryAvailability({
          capability: "any-turn",
          latestTurn: { ...completedTurn, state, completedAt: null },
          messages: [
            {
              id: previousMessageId,
              role: "assistant",
              streaming: false,
              turnId: previousTurnId,
            },
            {
              id: completedTurn.assistantMessageId,
              role: "assistant",
              streaming: true,
              turnId: completedTurn.turnId,
            },
          ],
          completedTurnIds: new Set([previousTurnId]),
        }),
      ).toEqual({
        enabled: true,
        target: { turnId: previousTurnId, messageId: previousMessageId },
        disabledReason: null,
      });
    },
  );

  it("tells the sidebar to open a running any-turn thread rather than claiming no turn completed", () => {
    // The sidebar builds its menu from the shell, so an unopened thread has no
    // messages to search. Omitted messages mean unknown, not none.
    expect(
      resolveForkEntryAvailability({
        capability: "any-turn",
        latestTurn: { ...completedTurn, state: "running", completedAt: null },
      }),
    ).toEqual({
      enabled: false,
      target: null,
      disabledReason: "Open this thread to fork an earlier response.",
    });

    // Loaded detail that really holds no completed turn keeps the original copy.
    expect(
      resolveForkEntryAvailability({
        capability: "any-turn",
        latestTurn: { ...completedTurn, state: "running", completedAt: null },
        messages: [],
        completedTurnIds: new Set(),
      }),
    ).toMatchObject({
      enabled: false,
      disabledReason: "Complete a turn before forking this thread.",
    });

    // A thread that has never run a turn has not completed one, loaded or not.
    expect(
      resolveForkEntryAvailability({ capability: "any-turn", latestTurn: null }),
    ).toMatchObject({
      enabled: false,
      disabledReason: "Complete a turn before forking this thread.",
    });
  });

  it("ignores finalized assistant messages from interrupted and failed turns", () => {
    const completedTurnId = TurnId.make("turn-completed");
    const interruptedTurnId = TurnId.make("turn-interrupted");
    const failedTurnId = TurnId.make("turn-failed");

    expect(
      resolveForkEntryAvailability({
        capability: "any-turn",
        latestTurn: { ...completedTurn, state: "running", completedAt: null },
        messages: [
          {
            id: MessageId.make("message-completed"),
            role: "assistant",
            streaming: false,
            turnId: completedTurnId,
          },
          {
            id: MessageId.make("message-interrupted"),
            role: "assistant",
            streaming: false,
            turnId: interruptedTurnId,
          },
          {
            id: MessageId.make("message-failed"),
            role: "assistant",
            streaming: false,
            turnId: failedTurnId,
          },
        ],
        completedTurnIds: new Set([completedTurnId]),
      }),
    ).toMatchObject({
      enabled: true,
      target: { turnId: completedTurnId, messageId: MessageId.make("message-completed") },
    });
  });

  it("derives completed turn ids only from ready checkpoints", () => {
    expect(
      completedTurnIdsFromCheckpoints([
        { turnId: TurnId.make("turn-ready"), status: "ready" },
        { turnId: TurnId.make("turn-interrupted"), status: "missing" },
        { turnId: TurnId.make("turn-error"), status: "error" },
      ]),
    ).toEqual(new Set([TurnId.make("turn-ready")]));
  });

  it("allows checkpointed earlier responses for any-turn providers and only the latest for latest-turn providers", () => {
    const earlierTurnId = TurnId.make("turn-1");
    const completedTurnIds = new Set([earlierTurnId]);
    expect(
      canForkCompletedAssistantMessage({
        capability: "any-turn",
        completed: true,
        messageTurnId: earlierTurnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds,
      }),
    ).toBe(true);
    expect(
      canForkCompletedAssistantMessage({
        capability: "latest-turn",
        completed: true,
        messageTurnId: earlierTurnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds,
      }),
    ).toBe(false);
    expect(
      canForkCompletedAssistantMessage({
        capability: "latest-turn",
        completed: true,
        messageTurnId: completedTurn.turnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds: new Set(),
      }),
    ).toBe(true);
    expect(
      canForkCompletedAssistantMessage({
        capability: "any-turn",
        completed: false,
        messageTurnId: completedTurn.turnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds,
      }),
    ).toBe(false);
  });

  it("hides the fork menu on earlier responses from interrupted or failed turns", () => {
    // A finalized assistant row from a turn without a ready checkpoint is
    // not forkable; the server would refuse it as not completed.
    expect(
      canForkCompletedAssistantMessage({
        capability: "any-turn",
        completed: true,
        messageTurnId: TurnId.make("turn-interrupted"),
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds: new Set([TurnId.make("turn-1")]),
      }),
    ).toBe(false);
    // The latest completed turn is forkable before its checkpoint lands.
    expect(
      canForkCompletedAssistantMessage({
        capability: "any-turn",
        completed: true,
        messageTurnId: completedTurn.turnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds: new Set(),
      }),
    ).toBe(true);
    expect(
      canForkCompletedAssistantMessage({
        capability: undefined,
        completed: true,
        messageTurnId: completedTurn.turnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds: new Set(),
      }),
    ).toBe(false);
    expect(
      canForkCompletedAssistantMessage({
        capability: "unsupported",
        completed: true,
        messageTurnId: completedTurn.turnId,
        latestCompletedTurnId: completedTurn.turnId,
        completedTurnIds: new Set([completedTurn.turnId]),
      }),
    ).toBe(false);
  });
});

describe("side chat promotion", () => {
  it("leaves the panel open when promotion fails", async () => {
    const closeSurface = vi.fn();
    const navigate = vi.fn(async () => undefined);

    await expect(
      runPromoteSideChat({ update: async () => false, closeSurface, navigate }),
    ).resolves.toBe(false);
    expect(closeSurface).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("closing side chats", () => {
  const host = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("parent"));
  const childId = ThreadId.make("side-chat");
  const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, host);

  beforeEach(() => {
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
    useRightPanelStore.getState().openSideChat(host, childId);
  });

  it("keeps the conversation open until settlement succeeds, then closes the final tab", async () => {
    const receipt = Promise.resolve().then(() => true);
    const closing = runCloseSideChat({
      settle: () => receipt,
      closeSurface: () => useRightPanelStore.getState().closeSurface(host, `side-chat:${childId}`),
    });

    expect(panel().surfaces).toHaveLength(1);
    expect(panel().isOpen).toBe(true);
    await expect(closing).resolves.toBe(true);
    expect(panel().surfaces).toEqual([]);
    expect(panel().isOpen).toBe(false);
  });

  it("keeps the side chat and selected tab intact if settlement fails", async () => {
    const before = panel();
    await expect(
      runCloseSideChat({
        settle: async () => false,
        closeSurface: () =>
          useRightPanelStore.getState().closeSurface(host, `side-chat:${childId}`),
      }),
    ).resolves.toBe(false);
    expect(panel()).toBe(before);
  });

  it("preserves a failed side chat during bulk closure and leaves another environment's tabs open", async () => {
    const otherHost = scopeThreadRef(EnvironmentId.make("env-b"), host.threadId);
    const otherChildId = ThreadId.make("other-side-chat");
    const store = useRightPanelStore.getState();
    store.openSideChat(host, otherChildId);
    store.openSideChat(otherHost, childId);
    store.open(host, "files");
    const otherPanel = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      otherHost,
    );

    await Promise.all([
      runCloseSideChat({
        settle: async () => false,
        closeSurface: () => store.closeSurface(host, `side-chat:${childId}`),
      }),
      runCloseSideChat({
        settle: async () => true,
        closeSurface: () => store.closeSurface(host, `side-chat:${otherChildId}`),
      }),
    ]);
    store.closeSurface(host, "files");

    expect(panel().surfaces.map((surface) => surface.id)).toEqual([`side-chat:${childId}`]);
    expect(panel().activeSurfaceId).toBe(`side-chat:${childId}`);
    expect(panel().isOpen).toBe(true);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, otherHost)).toBe(
      otherPanel,
    );
  });
});
