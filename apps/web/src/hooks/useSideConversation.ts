import { newThreadId } from "../lib/utils";
import { useCallback, useRef, useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { latestStableSideConversationRun } from "@t3tools/client-runtime/state/side-conversations";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type RunId, type ScopedThreadRef } from "@t3tools/contracts";
import { useThreadProjection, useServerConfigs } from "../state/entities";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useComposerDraftStore } from "../composerDraftStore";
import { useRightPanelStore } from "../rightPanelStore";

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
  const fork = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const create = useCallback(
    async (question = "", runId?: RunId) => {
      if (inFlight.current) return null;
      if (!supported)
        throw new Error("Update this environment's server to use side conversations.");
      if (!connected) throw new Error("Reconnect to this environment to open a side conversation.");
      const sourceRunId = runId ?? stableRunId;
      if (!sourceRunId)
        throw new Error("A side conversation needs a completed, checkpointed turn.");
      const threadId = newThreadId();
      const ref = scopeThreadRef(environmentId, threadId);
      const sourceRef = scopeThreadRef(environmentId, ownerThreadId);
      inFlight.current = true;
      setCreating(true);
      try {
        const result = await fork({
          environmentId: sourceRef.environmentId,
          input: {
            sourceThreadId: sourceRef.threadId,
            targetThreadId: threadId,
            runId: sourceRunId,
            presentation: "side",
            runtimeMode: "approval-required",
            title: "Side conversation",
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        // Preserve the question even if the shell stream has not caught up yet.
        useComposerDraftStore.getState().setPrompt(ref, question);
        useRightPanelStore.getState().openSideConversation(sourceRef, threadId);
        return ref;
      } finally {
        inFlight.current = false;
        setCreating(false);
      }
    },
    [connected, environmentId, ownerThreadId, stableRunId, supported],
  );
  return {
    create,
    creating,
    supported,
    available: supported && connected && stableRun !== null && !creating,
  };
}
