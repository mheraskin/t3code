import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CheckpointId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";

import { useSideConversation } from "./useSideConversation";

const testState = vi.hoisted(() => ({
  runs: [] as OrchestrationV2Run[],
  status: "live",
  supported: true,
  drafts: new Map<string, string>(),
  opened: [] as Array<{ owner: ScopedThreadRef; childId: ThreadId }>,
  fork: vi.fn<(input: unknown) => Promise<AtomCommandResult<void, Error>>>(),
  start: vi.fn<(input: unknown) => Promise<AtomCommandResult<void, Error>>>(),
  notify: vi.fn(),
}));

vi.mock("../state/entities", () => ({
  useThreadProjection: () => ({
    projection: { runs: testState.runs, thread: { interactionMode: "default" } },
  }),
  useServerConfigs: () =>
    new Map([
      [
        "environment:side",
        { environment: { capabilities: { threadSideConversations: testState.supported } } },
      ],
    ]),
}));
vi.mock("../state/threads", () => ({
  threadEnvironment: { forkFromRun: "fork", startTurn: "start" },
  useEnvironmentThread: () => ({ status: testState.status }),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "fork" ? testState.fork : testState.start),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: testState.notify } }));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: {
    getState: () => ({
      getComposerDraft: (ref: ScopedThreadRef) => ({
        prompt: testState.drafts.get(scopedThreadKey(ref)) ?? "",
      }),
      setPrompt: (ref: ScopedThreadRef, prompt: string) =>
        testState.drafts.set(scopedThreadKey(ref), prompt),
    }),
  },
}));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({
      openConversation: (owner: ScopedThreadRef, childId: ThreadId) => {
        testState.opened.push({ owner, childId });
      },
    }),
  },
}));

const environmentId = EnvironmentId.make("environment:side");
const ownerRef = { environmentId, threadId: ThreadId.make("thread:parent") };
const otherRef = { environmentId, threadId: ThreadId.make("thread:other") };
const now = DateTime.makeUnsafe("2026-10-03T00:00:00.000Z");
let renderer: ReactTestRenderer;
let controller: ReturnType<typeof useSideConversation>;

function run(ordinal: number, status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return {
    id: RunId.make(`run:${ordinal}`),
    threadId: ownerRef.threadId,
    ordinal,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    queuePosition: null,
    requestedAt: now,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    checkpointId: status === "completed" ? CheckpointId.make(`checkpoint:${ordinal}`) : null,
    contextHandoffId: null,
  };
}

function Probe({ owner }: { owner: ScopedThreadRef }) {
  const value = useSideConversation(owner);
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  testState.runs = [run(1, "completed"), run(2, "running")];
  testState.status = "live";
  testState.supported = true;
  testState.drafts.clear();
  testState.opened.length = 0;
  testState.fork.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  testState.start.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  testState.notify.mockReset();
  testState.drafts.set(scopedThreadKey(ownerRef), "parent work in progress");
  act(() => {
    renderer = create(<Probe owner={ownerRef} />);
  });
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("side conversation creation", () => {
  it("sends the question as the child's first turn instead of leaving it unsent", async () => {
    await act(async () => {
      const child = await controller.create("Explain this change");
      if (child === null) throw new Error("Expected a committed child");
      expect(testState.start).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({
          threadId: child.threadId,
          message: expect.objectContaining({ role: "user", text: "Explain this change" }),
        }),
      });
      expect(testState.drafts.get(scopedThreadKey(child))).toBe("");
      expect(testState.drafts.get(scopedThreadKey(ownerRef))).toBe("parent work in progress");
    });
  });
  it("branches from stable history while the parent is working and keeps its draft", async () => {
    await act(async () => {
      const child = await controller.create("Explain this change");
      expect(child).not.toBeNull();
      if (child === null) throw new Error("Expected a committed child");
      expect(testState.fork).toHaveBeenCalledWith({
        environmentId,
        input: {
          sourceThreadId: ownerRef.threadId,
          targetThreadId: child.threadId,
          runId: RunId.make("run:1"),
          presentation: "side",
          runtimeMode: "approval-required",
          title: "Side conversation",
        },
      });
      expect(testState.drafts.get(scopedThreadKey(child))).toBe("");
      expect(testState.drafts.get(scopedThreadKey(ownerRef))).toBe("parent work in progress");
      expect(testState.opened).toEqual([{ owner: ownerRef, childId: child.threadId }]);
    });
    expect(controller.creating).toBe(false);
  });

  it("keeps an in-flight child and question attached to the original owner after navigation", async () => {
    let finishFork: (value: AtomCommandResult<void, Error>) => void = () => undefined;
    testState.fork.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFork = resolve;
        }),
    );
    let pending: Promise<ScopedThreadRef | null>;
    act(() => {
      pending = controller.create("Original question");
    });
    expect(controller.creating).toBe(true);
    act(() => renderer.update(<Probe owner={otherRef} />));
    testState.drafts.set(scopedThreadKey(ownerRef), "new parent draft");
    testState.drafts.set(scopedThreadKey(otherRef), "other draft");
    await act(async () => {
      finishFork(AsyncResult.success(undefined));
      const child = await pending;
      if (child === null) throw new Error("Expected a committed child");
      expect(testState.drafts.get(scopedThreadKey(child))).toBe("");
      expect(testState.start).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({
          threadId: child.threadId,
          message: expect.objectContaining({ text: "Original question" }),
        }),
      });
      expect(testState.opened).toEqual([{ owner: ownerRef, childId: child.threadId }]);
    });
    expect(testState.drafts.get(scopedThreadKey(ownerRef))).toBe("new parent draft");
    expect(testState.drafts.get(scopedThreadKey(otherRef))).toBe("other draft");
  });

  it("preserves existing drafts after a rejected fork and permits a retry", async () => {
    testState.fork.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("fork rejected"))),
    );
    await act(async () => {
      await expect(controller.create("Keep this question")).rejects.toThrow("fork rejected");
    });
    expect(controller.creating).toBe(false);
    expect(testState.opened).toEqual([]);
    expect([...testState.drafts.values()]).toEqual(["parent work in progress"]);
    await act(async () => {
      await controller.create("Keep this question");
    });
    expect(testState.fork).toHaveBeenCalledTimes(2);
    expect(testState.start).toHaveBeenCalledOnce();
  });

  it("prevents overlapping clicks from creating multiple children", async () => {
    let finishFork: (value: AtomCommandResult<void, Error>) => void = () => undefined;
    testState.fork.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFork = resolve;
        }),
    );
    await act(async () => {
      const first = controller.create("First question");
      await expect(controller.create("Second question")).resolves.toBeNull();
      finishFork(AsyncResult.success(undefined));
      await first;
    });
    expect(testState.fork).toHaveBeenCalledOnce();
    expect(testState.opened).toHaveLength(1);
    expect(testState.start).toHaveBeenCalledOnce();
    expect([...testState.drafts.values()]).not.toContain("Second question");
  });

  it("requires a live capable environment and stable history before dispatching", async () => {
    testState.status = "cached";
    act(() => renderer.update(<Probe owner={ownerRef} />));
    expect(controller.available).toBe(false);
    await expect(controller.create()).rejects.toThrow("Reconnect");
    testState.status = "live";
    testState.runs = [run(1, "running")];
    act(() => renderer.update(<Probe owner={ownerRef} />));
    expect(controller.available).toBe(false);
    await expect(controller.create()).rejects.toThrow("completed, checkpointed turn");
    testState.supported = false;
    act(() => renderer.update(<Probe owner={ownerRef} />));
    await expect(controller.create()).rejects.toThrow("Update this environment");
    expect(testState.fork).not.toHaveBeenCalled();
  });

  it("keeps the question in the opened child's draft if its first turn is rejected", async () => {
    testState.start.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("send rejected"))),
    );
    await act(async () => {
      const child = await controller.create("Keep this question");
      if (child === null) throw new Error("Expected a committed child");
      expect(testState.drafts.get(scopedThreadKey(child))).toBe("Keep this question");
      expect(testState.opened).toEqual([{ owner: ownerRef, childId: child.threadId }]);
    });
    expect(testState.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("send rejected"),
      }),
    );
    expect(testState.drafts.get(scopedThreadKey(ownerRef))).toBe("parent work in progress");
    expect(controller.creating).toBe(false);
  });

  it("holds creation busy through submission and preserves a newer child draft", async () => {
    let finishSend: (value: AtomCommandResult<void, Error>) => void = () => undefined;
    testState.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    await act(async () => {
      const pending = controller.create("First question");
      await Promise.resolve();
      const childKey = [...testState.drafts.keys()].find(
        (key) => key !== scopedThreadKey(ownerRef),
      );
      if (!childKey) throw new Error("Expected a child draft");
      expect(testState.opened).toEqual([]);
      testState.drafts.set(childKey, "A newer question");
      await expect(controller.create("Second question")).resolves.toBeNull();
      finishSend(AsyncResult.success(undefined));
      await pending;
      expect(testState.drafts.get(childKey)).toBe("A newer question");
    });
    expect(testState.fork).toHaveBeenCalledOnce();
    expect(testState.start).toHaveBeenCalledOnce();
    expect(testState.opened).toHaveLength(1);
    expect(controller.creating).toBe(false);
  });

  it("opens an empty side conversation without starting an empty turn", async () => {
    await act(async () => {
      await controller.create();
    });
    expect(testState.start).not.toHaveBeenCalled();
    expect(testState.opened).toHaveLength(1);
  });
});
