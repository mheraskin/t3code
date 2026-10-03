import { useIsFocused, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isSideConversation,
  latestStableSideConversationRun,
  sideConversationContextLabel,
  sideConversationOwnerThreadId,
  sideConversationsForThread,
} from "@t3tools/client-runtime/state/side-conversations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { MessageId, ThreadId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { uuidv4 } from "../../lib/uuid";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useEnvironmentServerConfig, useThreadShells } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { waitForThreadShellReady } from "./threadForkNavigation";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";

export function useMobileSideConversationActions({
  thread,
  projection,
}: {
  readonly thread: EnvironmentThreadShell | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
}) {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const forkFromRun = useAtomCommand(threadEnvironment.forkFromRun, "create side conversation");
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const creating = useRef(false);
  const [busy, setBusy] = useState(false);
  const config = useEnvironmentServerConfig(thread?.environmentId ?? null);
  const enabled = config?.environment.capabilities.threadSideConversations === true;
  const open = useCallback(
    async (draft = "") => {
      if (creating.current || thread === null || !enabled) return false;
      const run = latestStableSideConversationRun(projection);
      if (run === null) {
        Alert.alert(
          "No completed response yet",
          "A side conversation starts from a completed response. Wait for the first response to finish.",
        );
        return false;
      }
      const source = thread;
      const targetThreadId = ThreadId.make(uuidv4());
      creating.current = true;
      setBusy(true);
      try {
        const result = await forkFromRun({
          environmentId: source.environmentId,
          input: {
            sourceThreadId: source.id,
            targetThreadId,
            runId: run.id,
            title: `${source.title} side conversation`,
            presentation: "side",
            runtimeMode: source.runtimeMode,
            creationSource: "mobile",
          },
        });
        if (result._tag !== "Success") return false;
        const childKey = scopedThreadKey(source.environmentId, targetThreadId);
        setComposerDraftText(childKey, draft);
        if (draft.trim()) {
          const sent = await startTurn({
            environmentId: source.environmentId,
            input: {
              threadId: targetThreadId,
              message: {
                messageId: MessageId.make(uuidv4()),
                role: "user",
                text: draft.trim(),
                attachments: [],
              },
              runtimeMode: source.runtimeMode,
              interactionMode: source.interactionMode,
              dispatchMode: "start",
            },
          });
          if (sent._tag === "Success") {
            if (getComposerDraftSnapshot(childKey).text === draft)
              setComposerDraftText(childKey, "");
          } else {
            Alert.alert(
              "Question not sent",
              "Your question is saved in the side conversation's draft. Open it to retry.",
            );
          }
        }
        const atom = environmentThreadShells.threadShellAtom(
          scopeThreadRef(source.environmentId, targetThreadId),
        );
        const ready = await waitForThreadShellReady({
          read: () => appAtomRegistry.get(atom) !== null,
        });
        if (!ready) {
          Alert.alert(
            "Side conversation created",
            "Reconnect and open it from its parent conversation.",
          );
          return true;
        }
        navigation.navigate("Thread", {
          environmentId: source.environmentId,
          threadId: targetThreadId,
        });
        return true;
      } finally {
        creating.current = false;
        setBusy(false);
      }
    },
    [enabled, forkFromRun, startTurn, projection, thread, navigation],
  );
  const openFromKeyboard = useCallback(() => {
    if (!enabled || !isFocused || thread === null) return false;
    void open();
    return true;
  }, [enabled, isFocused, open, thread]);
  useHardwareKeyboardCommand("thread.sideConversation", openFromKeyboard);
  return { open, busy, enabled };
}

export function MobileSideConversationToolbar(props: {
  readonly thread: EnvironmentThreadShell;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly onCreate: () => void;
}) {
  const navigation = useNavigation();
  const threads = useThreadShells();
  const updateMetadata = useAtomCommand(
    threadEnvironment.updateMetadata,
    "promote side conversation",
  );
  const archive = useAtomCommand(threadEnvironment.archive, "archive side conversation");
  const unarchive = useAtomCommand(threadEnvironment.unarchive, "unarchive side conversation");
  const remove = useAtomCommand(threadEnvironment.delete, "discard side conversation");
  const ownerId = sideConversationOwnerThreadId(props.thread);
  const owner = threads.find(
    (thread) => thread.environmentId === props.thread.environmentId && thread.id === ownerId,
  );
  const sides = sideConversationsForThread(
    threads,
    scopeThreadRef(props.thread.environmentId, props.thread.id),
  );
  const openThread = (threadId: ThreadId) =>
    navigation.navigate("Thread", { environmentId: props.thread.environmentId, threadId });
  const returnToOwner = () => (owner ? openThread(owner.id) : navigation.navigate("Home"));
  const actions = () =>
    Alert.alert(
      "Side conversation",
      "Keep it with its parent, promote it to the main list, or discard it.",
      [
        {
          text: "Promote to thread",
          onPress: () => {
            void updateMetadata({
              environmentId: props.thread.environmentId,
              input: { threadId: props.thread.id, presentation: { kind: "standard" } },
            });
          },
        },
        {
          text: props.thread.archivedAt ? "Unarchive" : "Archive",
          onPress: () => {
            void (props.thread.archivedAt ? unarchive : archive)({
              environmentId: props.thread.environmentId,
              input: { threadId: props.thread.id },
            }).then((result) => {
              if (result._tag === "Success") returnToOwner();
            });
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () =>
            Alert.alert("Discard side conversation?", "Its conversation will be deleted.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Discard",
                style: "destructive",
                onPress: () => {
                  void remove({
                    environmentId: props.thread.environmentId,
                    input: { threadId: props.thread.id },
                  }).then((result) => {
                    if (result._tag === "Success") returnToOwner();
                  });
                },
              },
            ]),
        },
      ],
      { cancelable: true },
    );
  if (!props.enabled && sides.length === 0 && !isSideConversation(props.thread)) return null;
  return (
    <View className="border-b border-border bg-screen px-3">
      {isSideConversation(props.thread) ? (
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to parent conversation"
            onPress={returnToOwner}
            className="min-h-11 flex-1 justify-center active:opacity-60"
          >
            <Text className="text-sm text-foreground" numberOfLines={1}>
              ← {owner?.title ?? "Parent unavailable"}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {sideConversationContextLabel(props.projection)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Side conversation actions"
            onPress={actions}
            className="min-h-11 min-w-11 items-center justify-center active:opacity-60"
          >
            <Text className="text-sm text-foreground">Actions</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {props.enabled ? (
          <Pressable
            accessibilityRole="button"
            disabled={props.busy}
            onPress={props.onCreate}
            className="min-h-11 justify-center pr-4 active:opacity-60 disabled:opacity-40"
          >
            <Text className="text-sm text-primary">
              {props.busy ? "Creating…" : "+ Side conversation"}
            </Text>
          </Pressable>
        ) : null}
        {sides.map((side) => (
          <Pressable
            key={side.id}
            accessibilityRole="button"
            onPress={() => {
              if (side.archivedAt === null) openThread(side.id);
              else
                void unarchive({
                  environmentId: side.environmentId,
                  input: { threadId: side.id },
                }).then((result) => {
                  if (result._tag === "Success") openThread(side.id);
                });
            }}
            className="min-h-11 justify-center pr-4 active:opacity-60"
          >
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {side.hasPendingApprovals || side.hasPendingUserInput ? "Needs attention · " : ""}
              {side.title}
              {side.archivedAt !== null ? " · Archived" : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
