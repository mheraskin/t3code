import { newMessageId, newThreadId } from "../lib/utils";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "./composerContextPresentation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { sideConversationContextLabel } from "@t3tools/client-runtime/state/side-conversations";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  deriveThreadActivityRun,
  deriveThreadRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ThreadId,
  type ScopedThreadRef,
  type RuntimeRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type ChatFileAttachment,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import {
  useProject,
  useServerConfigs,
  useThreadProjection,
  useThreadShell,
  useThreadHistory,
  useThreadVisibleTurnItems,
} from "../state/entities";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useAtomCommand } from "../state/use-atom-command";
import { useComposerThreadDraft, useComposerDraftStore } from "../composerDraftStore";
import { useRightPanelStore } from "../rightPanelStore";
import {
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  deriveCanInterruptRunningThread,
  type TimelineEntriesProjection,
} from "../session-logic";
import {
  buildPendingUserInputAnswers,
  carryDisplacedCustomAnswerIntoPrompt,
  togglePendingUserInputOptionSelection,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { useTheme } from "../hooks/useTheme";
import { buildThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";
import { ComposerPendingApprovalPanel } from "./chat/ComposerPendingApprovalPanel";
import { runtimeModeConfig } from "./chat/runtimeModeConfig";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { shouldShowLoadEarlierControl } from "@t3tools/client-runtime/state/threads";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { primaryServerKeybindingsAtom } from "../state/server";
import { resolveShortcutCommand } from "../keybindings";
import { composerSubmissionIntentForKey } from "../composer-logic";
import {
  resolveComposerDispatchMode,
  type ComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import { isElectron } from "../env";
import { useDiffPanelStore } from "../diffPanelStore";
import { assetEnvironment } from "../state/assets";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { readPreparedConnection } from "../state/session";
import { resolveFileAttachmentUrl } from "./ChatView.logic";
import { readPastedComposerContext } from "./composerInlineTokenPaste";

const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
];
const EMPTY_ATTACHMENTS = new Map<string, string>();
const EMPTY_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="menuitem"], [role="option"]';

function createTimelineProjector() {
  let previous: TimelineEntriesProjection | null = null;
  return (input: Parameters<typeof deriveTimelineEntriesFromVisibleTurnItemsWithState>[0]) => {
    previous = deriveTimelineEntriesFromVisibleTurnItemsWithState(input, previous);
    return previous.entries;
  };
}

export function SideConversationPanel({
  ownerRef,
  threadId,
  visible = true,
}: {
  ownerRef: ScopedThreadRef;
  threadId: ThreadId;
  visible?: boolean;
}) {
  const ref = useMemo(
    () => scopeThreadRef(ownerRef.environmentId, threadId),
    [ownerRef.environmentId, threadId],
  );
  const key = scopedThreadKey(ref);
  const state = useEnvironmentThread(ref.environmentId, threadId);
  const shell = useThreadShell(ref);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(ref);
  const history = useThreadHistory(ref);
  const project = useProject(shell ? scopeProjectRef(ref.environmentId, shell.projectId) : null);
  const config = useServerConfigs().get(ref.environmentId);
  const draft = useComposerThreadDraft(ref);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusedOnOpen = useRef(false);
  const listRef = useRef<LegendListRef>(null);
  const [cursor, setCursor] = useState(draft.prompt.length);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [image, setImage] = useState<ExpandedImagePreview | null>(null);
  const [answersByRequest, setAnswersByRequest] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const settings = useEnvironmentSettings(ref.environmentId);
  const { turnDiffSummaries } = useTurnDiffSummaries(projection);
  const start = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const approve = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const respond = useAtomCommand(threadEnvironment.respondToUserInput, { reportFailure: false });
  const dismiss = useAtomCommand(threadEnvironment.dismissUserInput, { reportFailure: false });
  const update = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const fork = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const revert = useAtomCommand(threadEnvironment.revertCheckpoint, { reportFailure: false });
  const loadEarlier = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    reportFailure: false,
  });
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const runtime = projection ? deriveThreadRuntime(projection) : null;
  const latestRun = projection ? deriveThreadActivityRun(projection) : null;
  const working = runtime !== null && ["starting", "running", "preparing"].includes(runtime.status);
  const runtimeRequests = projection?.runtimeRequests;
  const turnItems = projection?.turnItems;
  const requests = useMemo(
    () =>
      runtimeRequests && turnItems
        ? derivePendingThreadRequests({ runtimeRequests, turnItems })
        : { approvals: [], userInputs: [] },
    [runtimeRequests, turnItems],
  );
  const attempts = projection?.attempts;
  const nodes = projection?.nodes;
  const plans = projection?.plans;
  const projectTimeline = useMemo(() => createTimelineProjector(), []);
  const entries = useMemo(
    () =>
      projectTimeline({
        visibleTurnItems,
        optimisticMessages: [],
        attachmentUrlById: EMPTY_ATTACHMENTS,
        ...(attempts ? { attempts } : {}),
        ...(nodes ? { nodes } : {}),
        ...(plans ? { plans } : {}),
      }),
    [projectTimeline, visibleTurnItems, attempts, nodes, plans],
  );
  const connected = state.status === "live";
  const modelSelection = shell
    ? (draft.modelSelectionByProvider[draft.activeProvider ?? shell.modelSelection.instanceId] ??
      shell.modelSelection)
    : null;
  const runtimeMode = draft.runtimeMode ?? shell?.runtimeMode;
  const interactionMode = draft.interactionMode ?? shell?.interactionMode;
  const hasExtraDraftContent =
    draft.images.length > 0 ||
    draft.files.length > 0 ||
    draft.persistedAttachments.length > 0 ||
    draft.terminalContexts.length > 0 ||
    draft.previewAnnotations.length > 0 ||
    draft.reviewComments.length > 0 ||
    draft.threadContexts.length > 0;
  const editorEnabled = connected && !busy && shell?.archivedAt === null && !hasExtraDraftContent;
  useLayoutEffect(() => {
    focusedOnOpen.current = false;
    if (visible) sectionRef.current?.focus({ preventScroll: true });
  }, [visible]);
  useEffect(() => {
    if (!visible || !connected || shell?.archivedAt === undefined || focusedOnOpen.current) return;
    focusedOnOpen.current = true;
    if (
      !hasExtraDraftContent &&
      shell?.archivedAt === null &&
      sectionRef.current?.contains(document.activeElement)
    ) {
      editorRef.current?.focusAtEnd();
    }
  }, [visible, connected, hasExtraDraftContent, shell?.archivedAt]);
  const appendToDraft = (text: string) => {
    const prompt = useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
    const next = `${prompt}${text}`;
    useComposerDraftStore.getState().setPrompt(ref, next);
    setCursor(next.length);
    requestAnimationFrame(() => editorRef.current?.focusAtEnd());
  };
  const close = () => useRightPanelStore.getState().closeSurface(ownerRef, `side:${threadId}`);
  const run = async <A, E>(
    action: () => Promise<AtomCommandResult<A, E>>,
    success?: () => void,
  ) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      success?.();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const send = (
    dispatchMode: ComposerDispatchMode = resolveComposerDispatchMode({
      running: working,
      alternateModifier: false,
      activeTurnDefault: settings.followUpBehavior,
    }),
  ) => {
    const text = draft.prompt.trim();
    if (
      !shell ||
      !modelSelection ||
      !runtimeMode ||
      !interactionMode ||
      !connected ||
      !text ||
      hasExtraDraftContent ||
      requests.userInputs.length ||
      requests.approvals.length ||
      shell.archivedAt !== null
    )
      return;
    void run(
      () =>
        start({
          environmentId: ref.environmentId,
          input: {
            threadId,
            message: { messageId: newMessageId(), role: "user", text, attachments: [] },
            modelSelection,
            runtimeMode,
            interactionMode,
            dispatchMode,
          },
        }),
      () => {
        // A stream update or a second window may have changed this draft while sending.
        if (useComposerDraftStore.getState().draftsByThreadKey[key]?.prompt === draft.prompt)
          useComposerDraftStore.getState().setPrompt(ref, "");
        setFollowing(true);
      },
    );
  };
  const approvalResponse = (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) =>
    run(() =>
      approve({ environmentId: ref.environmentId, input: { threadId, requestId, decision } }),
    );
  const goToThread = (id: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(ref.environmentId, id)),
    });
  const downloadAttachment = async (attachment: ChatFileAttachment) => {
    const connection = readPreparedConnection(ref.environmentId);
    if (connection === null) {
      setError("The environment is not connected.");
      return;
    }
    try {
      const url = await resolveFileAttachmentUrl({
        attachment,
        environmentId: ref.environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl,
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The attachment is unavailable.");
    }
  };
  if (state.status === "deleted" || shell?.deletedAt)
    return (
      <div className="p-4 text-sm">
        This side conversation was deleted.
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
    );
  return (
    <section
      ref={sectionRef}
      data-side-conversation="true"
      data-chat-owner={key}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col"
      aria-label="Side conversation"
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && !event.target.closest(INTERACTIVE_SELECTOR)) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        const command = resolveShortcutCommand(event.nativeEvent, keybindings, {
          context: {
            terminalFocus: false,
            turnRunning: working,
            isDesktop: isElectron,
            isWeb: !isElectron,
            editableFocus:
              event.target instanceof Element &&
              Boolean(event.target.closest('input, textarea, [contenteditable="true"]')),
          },
        });
        if (
          command === "thread.stop" &&
          connected &&
          deriveCanInterruptRunningThread(shell !== null, runtime)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          void run(() => interrupt({ environmentId: ref.environmentId, input: { threadId } }));
          return;
        }
        if (
          command === null &&
          editorEnabled &&
          !event.defaultPrevented &&
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          event.target instanceof Element &&
          !event.target.closest(INTERACTIVE_SELECTOR)
        ) {
          event.preventDefault();
          event.stopPropagation();
          appendToDraft(event.key);
        }
      }}
      onPasteCapture={(event) => {
        if (
          !editorEnabled ||
          !(event.target instanceof Element) ||
          event.target.closest(INTERACTIVE_SELECTOR)
        )
          return;
        if (
          event.clipboardData.files.length > 0 ||
          (readPastedComposerContext(event.clipboardData)?.records.length ?? 0) > 0
        ) {
          event.preventDefault();
          event.stopPropagation();
          setError("Open the full conversation to paste attachments or context.");
          return;
        }
        const text = event.clipboardData.getData("text/plain");
        if (text) {
          event.preventDefault();
          event.stopPropagation();
          appendToDraft(text);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{shell?.title ?? "Side conversation"}</h2>
          <p className="text-xs text-muted-foreground">
            {sideConversationContextLabel(projection)} · shared workspace
          </p>
        </div>
        <Button size="xs" variant="ghost" disabled={!shell} onClick={() => goToThread(threadId)}>
          Open full conversation
        </Button>
        <Button
          size="xs"
          variant="ghost"
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
                goToThread(threadId);
              },
            )
          }
        >
          Promote
        </Button>
        <Button
          size="xs"
          variant="ghost"
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
          {shell?.archivedAt ? "Unarchive" : "Archive"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy || !connected}
          onClick={() => {
            if (window.confirm("Delete this side conversation and its history?"))
              void run(
                () => remove({ environmentId: ref.environmentId, input: { threadId } }),
                close,
              );
          }}
        >
          Discard
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <MessagesTimeline
          listRef={listRef}
          timelineEntries={entries}
          latestRun={latestRun}
          runningRunId={working ? (latestRun?.runId ?? null) : null}
          isWorking={working}
          activeTurnInProgress={working}
          turnDiffSummaries={turnDiffSummaries}
          routeThreadKey={key}
          activeThreadEnvironmentId={ref.environmentId}
          markdownCwd={shell?.worktreePath ?? project?.workspaceRoot ?? undefined}
          workspaceRoot={project?.workspaceRoot}
          resolvedTheme={resolvedTheme}
          timestampFormat={settings.timestampFormat}
          providerStatuses={config?.providers ?? []}
          runs={projection?.runs ?? []}
          onOpenTurnDiff={(runId, filePath) => {
            useDiffPanelStore.getState().selectTurn(ref, runId, filePath);
            useRightPanelStore.getState().open(ref, "diff");
            goToThread(threadId);
          }}
          onOpenThread={goToThread}
          onForkFromRun={async ({ sourceThreadId, runId }) => {
            const targetThreadId = newThreadId();
            await run(
              () =>
                fork({
                  environmentId: ref.environmentId,
                  input: { sourceThreadId, targetThreadId, runId },
                }),
              () => goToThread(targetThreadId),
            );
          }}
          onRollbackCheckpoint={(input) => {
            if (
              window.confirm("Restore this side conversation's checkpoint in the shared workspace?")
            )
              void run(() =>
                revert({ environmentId: ref.environmentId, input: { threadId, ...input } }),
              );
          }}
          supportsConversationRollback={false}
          onRevertToTurnCount={(turnCount) => {
            if (window.confirm("Revert this side conversation in the shared workspace?"))
              void run(() =>
                revert({ environmentId: ref.environmentId, input: { threadId, turnCount } }),
              );
          }}
          isRevertingCheckpoint={busy}
          onImageExpand={setImage}
          onFileOpen={(attachment) => {
            useRightPanelStore.getState().openAttachment(ref, attachment);
            goToThread(threadId);
          }}
          onFileDownload={(attachment) => void downloadAttachment(attachment)}
          anchorMessageId={null}
          onAnchorReady={() => {}}
          onAnchorSizeChanged={() => {}}
          contentInsetEndAdjustment={0}
          onIsAtEndChange={setFollowing}
          liveFollowEnabled={following}
          onManualNavigation={() => setFollowing(false)}
          hideEmptyPlaceholder={!projection}
          {...(shouldShowLoadEarlierControl(history)
            ? {
                historyControls: {
                  hasMoreHistory: history.hasMoreHistory,
                  loading: history.loading,
                  error: history.error,
                  onLoadEarlier: () => {
                    void loadEarlier({ environmentId: ref.environmentId, input: { threadId } });
                  },
                },
              }
            : {})}
        />
      </div>
      <div className="flex max-h-[55%] shrink-0 flex-col gap-3 overflow-auto border-t p-3">
        {error || runtime?.lastError || Option.isSome(state.error) ? (
          <p role="alert" className="text-xs text-destructive">
            {error ?? runtime?.lastError ?? Option.getOrNull(state.error)}
          </p>
        ) : null}
        {!connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            {state.status === "empty" ? "Loading conversation…" : "Reconnecting…"}
          </p>
        ) : null}
        {requests.approvals.map((approval) => (
          <div key={approval.requestId} className="flex flex-wrap gap-2">
            <ComposerPendingApprovalPanel approval={approval} pendingCount={1} />
            {(approval.options ?? DEFAULT_APPROVAL_OPTIONS).map((option) => (
              <Button
                key={option.decision}
                size="xs"
                variant={option.decision === "accept" ? "default" : "outline"}
                disabled={busy || !connected || approval.responseCapability !== "live"}
                title={option.warning}
                aria-description={option.warning}
                onClick={() => void approvalResponse(approval.requestId, option.decision)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        ))}
        {requests.userInputs.map((request) => {
          const answers = answersByRequest[request.requestId] ?? EMPTY_ANSWERS;
          const answerDisabled =
            busy || !connected || request.responseCapability === "not_resumable";
          return (
            <form
              key={request.requestId}
              onSubmit={(event) => {
                event.preventDefault();
                if (answerDisabled) return;
                const resolved = buildPendingUserInputAnswers(request.questions, answers);
                if (resolved)
                  void run(
                    () =>
                      respond({
                        environmentId: ref.environmentId,
                        input: { threadId, requestId: request.requestId, answers: resolved },
                      }),
                    () =>
                      setAnswersByRequest((previous) => {
                        const { [request.requestId]: _answered, ...remaining } = previous;
                        return remaining;
                      }),
                  );
              }}
              className="space-y-3"
            >
              {request.questions.map((question) => (
                <fieldset key={question.id} className="space-y-2" disabled={answerDisabled}>
                  <legend className="text-sm">{question.question}</legend>
                  {question.options.map((option) => {
                    const value = option.value ?? option.label;
                    return (
                      <label key={value} className="flex items-start gap-2 text-sm">
                        <input
                          type={question.multiSelect ? "checkbox" : "radio"}
                          name={`${request.requestId}:${question.id}`}
                          checked={
                            answers[question.id]?.selectedOptionValues?.includes(value) ?? false
                          }
                          onChange={() => {
                            const currentPrompt =
                              useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "";
                            const nextPrompt = carryDisplacedCustomAnswerIntoPrompt(
                              currentPrompt,
                              answers[question.id]?.customAnswer,
                            );
                            if (nextPrompt !== currentPrompt) {
                              useComposerDraftStore.getState().setPrompt(ref, nextPrompt);
                            }
                            setAnswersByRequest((previous) => ({
                              ...previous,
                              [request.requestId]: {
                                ...previous[request.requestId],
                                [question.id]: togglePendingUserInputOptionSelection(
                                  question,
                                  previous[request.requestId]?.[question.id],
                                  value,
                                ),
                              },
                            }));
                          }}
                        />
                        <span>
                          {option.label}
                          {option.description ? (
                            <span className="block text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                  {question.allowCustomAnswer !== false ? (
                    <textarea
                      aria-label={`Answer: ${question.question}`}
                      value={answers[question.id]?.customAnswer ?? ""}
                      onChange={(event) =>
                        setAnswersByRequest((previous) => ({
                          ...previous,
                          [request.requestId]: {
                            ...previous[request.requestId],
                            [question.id]: setPendingUserInputCustomAnswer(
                              previous[request.requestId]?.[question.id],
                              event.target.value,
                            ),
                          },
                        }))
                      }
                      className="w-full rounded-md border bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ) : null}
                </fieldset>
              ))}
              <Button
                size="sm"
                type="submit"
                disabled={
                  busy ||
                  !connected ||
                  request.responseCapability === "not_resumable" ||
                  !buildPendingUserInputAnswers(request.questions, answers)
                }
              >
                Submit answer
              </Button>
              {request.dismissible ? (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={busy || !connected}
                  onClick={() =>
                    void run(() =>
                      dismiss({
                        environmentId: ref.environmentId,
                        input: { threadId, requestId: request.requestId },
                      }),
                    )
                  }
                >
                  Dismiss
                </Button>
              ) : null}
            </form>
          );
        })}
        {hasExtraDraftContent ? (
          <p role="status" className="text-xs text-muted-foreground">
            This draft contains attachments or context. Open the full conversation to send the
            complete draft.
          </p>
        ) : null}
        <ComposerPromptEditorTiptap
          value={draft.prompt}
          cursor={cursor}
          contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
          skills={[]}
          richTextEnabled={settings.composerRichTextEnabled}
          editorRef={editorRef}
          disabled={busy || !connected || shell?.archivedAt !== null || hasExtraDraftContent}
          ariaLabel="Side conversation message"
          placeholder="Ask a follow-up…"
          onChange={(value, nextCursor) => {
            useComposerDraftStore.getState().setPrompt(ref, value);
            setCursor(nextCursor);
          }}
          onPaste={(event) => {
            if (
              event.clipboardData.files.length > 0 ||
              (readPastedComposerContext(event.clipboardData)?.records.length ?? 0) > 0
            ) {
              event.preventDefault();
              event.stopPropagation();
              setError("Open the full conversation to paste attachments or context.");
            }
          }}
          onCommandKeyDown={(_command, event) => {
            const intent = composerSubmissionIntentForKey({
              event,
              keybindings,
              isMobileViewport: false,
              isDraftThread: false,
              isRunning: working,
              sendShortcut: settings.sendShortcut,
              prompt: draft.prompt,
            });
            if (intent === null) return false;
            event.preventDefault();
            if (intent === "background") {
              setError("Open the full conversation to send and create a new thread.");
            } else {
              send(
                resolveComposerDispatchMode({
                  running: working,
                  alternateModifier: intent === "alternate",
                  activeTurnDefault: settings.followUpBehavior,
                }),
              );
            }
            return true;
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {modelSelection?.model} · {runtimeMode ? runtimeModeConfig[runtimeMode].label : ""}
          </span>
          {deriveCanInterruptRunningThread(shell !== null, runtime) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !connected}
              onClick={() =>
                void run(() => interrupt({ environmentId: ref.environmentId, input: { threadId } }))
              }
            >
              Stop side conversation
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={
              busy ||
              !connected ||
              !draft.prompt.trim() ||
              hasExtraDraftContent ||
              requests.approvals.length > 0 ||
              requests.userInputs.length > 0 ||
              shell?.archivedAt !== null
            }
            onClick={() => send()}
          >
            Send
          </Button>
        </div>
      </div>
      {image ? <ExpandedImageDialog preview={image} onClose={() => setImage(null)} /> : null}
    </section>
  );
}
