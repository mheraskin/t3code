import { newMessageId, newThreadId } from "../lib/utils";
import { useRef, useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { latestStableSideConversationRun } from "@t3tools/client-runtime/state/side-conversations";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { type RunId, type ScopedThreadRef } from "@t3tools/contracts";
import { useThreadProjection, useServerConfigs } from "../state/entities";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useComposerDraftStore } from "../composerDraftStore";
import { useRightPanelStore } from "../rightPanelStore";
import { toastManager } from "../components/ui/toast";

/** Forks the side conversation, sends its first question, and opens it beside the owner. */
async function openSideConversation<A, E, B, F>(input: {
  readonly ref: ScopedThreadRef;
  readonly sourceRef: ScopedThreadRef;
  readonly question: string;
  readonly fork: () => Promise<AtomCommandResult<A, E>>;
  readonly send: (text: string) => Promise<AtomCommandResult<B, F>>;
}): Promise<ScopedThreadRef> {
  const { ref, sourceRef, question } = input;
  const forked = await input.fork();
  if (forked._tag === "Failure") throw squashAtomCommandFailure(forked);
  // Preserve the question even if the shell stream has not caught up yet.
  useComposerDraftStore.getState().setPrompt(ref, question);
  if (question.trim()) {
    try {
      const sent = await input.send(question.trim());
      if (sent._tag === "Failure") throw squashAtomCommandFailure(sent);
      if (useComposerDraftStore.getState().getComposerDraft(ref)?.prompt === question)
        useComposerDraftStore.getState().setPrompt(ref, "");
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Side conversation opened, but the question was not sent",
        description: `${error instanceof Error ? error.message : "The action failed."} Your question is saved in its draft.`,
      });
    }
  }
  useRightPanelStore.getState().openConversation(sourceRef, ref.threadId);
  return ref;
}

export function useSideConversation(ownerRef: ScopedThreadRef) {
  const { environmentId, threadId: ownerThreadId } = ownerRef;
  const projection = useThreadProjection(ownerRef)?.projection;
  const connected =
    useEnvironmentThread(ownerRef.environmentId, ownerRef.threadId).status === "live";
  const configs = useServerConfigs();
  const supported =
    configs.get(ownerRef.environmentId)?.environment.capabilities.threadSideConversations === true;
  const stableRun = latestStableSideConversationRun(projection);
  const stableRunId = stableRun?.id;
  const interactionMode = projection?.thread.interactionMode ?? "default";
  const fork = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const start = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const create = async (question = "", runId?: RunId) => {
    if (inFlight.current) return null;
    if (!supported) throw new Error("Update this environment's server to use side conversations.");
    if (!connected) throw new Error("Reconnect to this environment to open a side conversation.");
    const sourceRunId = runId ?? stableRunId;
    if (!sourceRunId) throw new Error("A side conversation needs a completed, checkpointed turn.");
    const threadId = newThreadId();
    const ref = scopeThreadRef(environmentId, threadId);
    const sourceRef = scopeThreadRef(environmentId, ownerThreadId);
    inFlight.current = true;
    setCreating(true);
    // Cleanup runs through the promise because the React Compiler cannot lower try/finally.
    return openSideConversation({
      ref,
      sourceRef,
      question,
      fork: () =>
        fork({
          environmentId: sourceRef.environmentId,
          input: {
            sourceThreadId: sourceRef.threadId,
            targetThreadId: threadId,
            runId: sourceRunId,
            presentation: "side",
            runtimeMode: "approval-required",
            title: "Side conversation",
          },
        }),
      send: (text) =>
        start({
          environmentId,
          input: {
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text,
              attachments: [],
            },
            runtimeMode: "approval-required",
            interactionMode,
            dispatchMode: "start",
          },
        }),
    }).finally(() => {
      inFlight.current = false;
      setCreating(false);
    });
  };
  return {
    create,
    creating,
    supported,
    available: supported && connected && stableRun !== null && !creating,
  };
}
