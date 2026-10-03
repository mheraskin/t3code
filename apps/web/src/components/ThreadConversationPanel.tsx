import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  Maximize2Icon,
  Trash2Icon,
} from "lucide-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { useThreadShell } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { useRightPanelStore } from "../rightPanelStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";

export function ThreadConversationPanel({
  ownerRef,
  threadId,
  children,
}: {
  ownerRef: ScopedThreadRef;
  threadId: ThreadId;
  children: ReactNode;
}) {
  const ref = useMemo(
    () => scopeThreadRef(ownerRef.environmentId, threadId),
    [ownerRef.environmentId, threadId],
  );
  const state = useEnvironmentThread(ref.environmentId, threadId);
  const shell = useThreadShell(ref);
  const isSideConversation = shell?.source.presentation?.kind === "side";
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const update = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const connected = state.status === "live";
  const close = () =>
    useRightPanelStore.getState().closeSurface(ownerRef, `conversation:${threadId}`);
  const openFullConversation = () =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  const run = async <A, E>(
    action: () => Promise<AtomCommandResult<A, E>>,
    success?: () => void,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      success?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (state.status === "deleted" || shell?.deletedAt)
    return (
      <div className="p-4 text-sm">
        This conversation was deleted.
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
    );
  return (
    <section
      data-conversation-panel="true"
      data-chat-owner={scopedThreadKey(ref)}
      className="flex h-full min-h-0 flex-col"
      aria-label={shell?.title ?? "Conversation"}
    >
      <div className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Open full conversation"
          aria-label="Open full conversation"
          disabled={!shell}
          onClick={openFullConversation}
        >
          <Maximize2Icon />
        </Button>
        {isSideConversation ? (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              title="Promote to full conversation"
              aria-label="Promote to full conversation"
              disabled={busy || !shell || !connected}
              onClick={() =>
                void run(
                  () =>
                    update({
                      environmentId: ref.environmentId,
                      input: { threadId, presentation: { kind: "standard" } },
                    }),
                  () => {
                    close();
                    openFullConversation();
                  },
                )
              }
            >
              <ArrowUpRightIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              title={shell?.archivedAt ? "Unarchive" : "Archive"}
              aria-label={
                shell?.archivedAt ? "Unarchive side conversation" : "Archive side conversation"
              }
              disabled={busy || !shell || !connected}
              onClick={() =>
                void run(() =>
                  (shell?.archivedAt ? unarchive : archive)({
                    environmentId: ref.environmentId,
                    input: { threadId },
                  }),
                )
              }
            >
              {shell?.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              title="Discard side conversation"
              aria-label="Discard side conversation"
              disabled={busy || !connected}
              onClick={() => {
                if (window.confirm("Delete this side conversation and its history?"))
                  void run(
                    () => remove({ environmentId: ref.environmentId, input: { threadId } }),
                    close,
                  );
              }}
            >
              <Trash2Icon />
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {children}
    </section>
  );
}
