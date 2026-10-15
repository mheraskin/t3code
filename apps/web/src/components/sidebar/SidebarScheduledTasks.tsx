/**
 * The sidebar's scheduled tasks shelf: every task on every connected
 * environment, above the thread list. Collapsed by default and absent when
 * there are no tasks, so it costs nothing to users who never schedule work.
 *
 * A row opens the task's dialog over the current screen, where it can be
 * changed or deleted. Its menu (also on right-click) adds the quick actions:
 * open the thread its runs post into, run now, pause or resume, delete. While
 * collapsed, the header still counts the tasks and flags any whose last run
 * failed. New tasks start from the header's plus button or the command
 * palette.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { requestConfirmDialog } from "../../confirmDialog";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useScheduledTaskEditorStore } from "../../scheduledTaskEditorStore";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  relativeLabel,
  scheduleLabel,
  useScheduledTaskActions,
} from "../settings/ScheduledTasksSettings";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SCHEDULED_SHELF_EXPANDED_KEY = "t3code:sidebar:scheduled-expanded";

const STATUS_DOT_CLASS: Record<ScheduledTask["lastRunStatus"], string> = {
  never: "bg-muted-foreground/40",
  running: "bg-sky-500",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
};

interface EnvironmentScheduledTask {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}

function useScheduledTasks(): readonly EnvironmentScheduledTask[] {
  const environmentIds = useConnectedEnvironmentIds();
  const tasksAtom = useMemo(
    () =>
      Atom.make((get) =>
        environmentIds.flatMap((environmentId) => {
          const result = get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} }));
          const tasks = Option.getOrNull(AsyncResult.value(result))?.tasks ?? [];
          return tasks.map((task) => ({ environmentId, task }));
        }),
      ),
    [environmentIds],
  );
  return useAtomValue(tasksAtom);
}

export function SidebarScheduledTasks() {
  const tasks = useScheduledTasks();
  const openNew = useScheduledTaskEditorStore((state) => state.openNew);
  const [expanded, setExpanded] = useLocalStorage(
    SCHEDULED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  if (tasks.length === 0) return null;
  const failedCount = tasks.filter(({ task }) => task.lastRunStatus === "failed").length;
  return (
    <section aria-label="Scheduled tasks" className="mx-0.5 mb-1">
      <div className="flex items-center gap-0.5">
        <CollapsibleSectionHeader
          expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          data-testid="sidebar-scheduled-shelf-toggle"
          accessory={
            <>
              {failedCount > 0 ? (
                <SectionHeaderStatus>{failedCount} failed</SectionHeaderStatus>
              ) : null}
              <span className="shrink-0 tabular-nums">{tasks.length}</span>
            </>
          }
        >
          Scheduled
        </CollapsibleSectionHeader>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                className="shrink-0"
                aria-label="New scheduled task"
                onClick={() => openNew()}
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">New scheduled task</TooltipPopup>
        </Tooltip>
      </div>
      {expanded ? <ScheduledTaskList tasks={tasks} /> : null}
    </section>
  );
}

// Split out so the minute tick that keeps "next in 5m" honest only runs while
// the list is open.
function ScheduledTaskList({ tasks }: { tasks: readonly EnvironmentScheduledTask[] }) {
  useRelativeTimeTick(60_000);
  return (
    <ul className="flex flex-col gap-px">
      {tasks.map(({ environmentId, task }) => (
        <ScheduledTaskRow
          key={`${environmentId}:${task.id}`}
          environmentId={environmentId}
          task={task}
        />
      ))}
    </ul>
  );
}

function ScheduledTaskRow({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const navigate = useNavigate();
  const openEdit = useScheduledTaskEditorStore((state) => state.openEdit);
  const { busy, canOperate, act } = useScheduledTaskActions(environmentId, task);
  const [menuOpen, setMenuOpen] = useState(false);
  const isWebhook = task.schedule.type === "webhook";
  const threadId = task.threadId;
  const deleteTask = async () => {
    const message = `Delete "${task.title}"?`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await act("delete");
  };
  return (
    <li
      className="group/task flex items-center"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <SidebarMenuButton
        className="h-auto min-w-0 flex-1"
        title={task.prompt}
        onClick={() => openEdit(environmentId, task)}
      >
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
          <CalendarClockIcon className="size-3.5 text-(--sidebar-icon-color)" />
          <span
            aria-hidden
            className={cn(
              "absolute -right-0.5 -top-0.5 size-1.5 rounded-full",
              STATUS_DOT_CLASS[task.lastRunStatus],
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              task.enabled ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
            )}
          >
            {task.title}
          </span>
          <span className="block truncate text-2xs text-sidebar-muted-foreground">
            {taskStatusLabel(task)}
          </span>
        </span>
      </SidebarMenuButton>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        {/* Shown on hover and focus; always shown on touch, where there is no hover. */}
        <span
          className={cn(
            "flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/task:opacity-100 pointer-coarse:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <MenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Actions for ${task.title}`}
              />
            }
          >
            <MoreHorizontalIcon className="size-3.5" />
          </MenuTrigger>
        </span>
        <MenuPopup align="end">
          <MenuItem onClick={() => openEdit(environmentId, task)}>
            <PencilIcon />
            Edit
          </MenuItem>
          {threadId ? (
            <MenuItem
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
                })
              }
            >
              <MessageSquareIcon />
              Open thread
            </MenuItem>
          ) : null}
          {isWebhook ? null : (
            <MenuItem disabled={busy || !canOperate} onClick={() => void act("run")}>
              <PlayIcon />
              Run now
            </MenuItem>
          )}
          <MenuItem disabled={busy || !canOperate} onClick={() => void act("toggle")}>
            {task.enabled ? <PauseIcon /> : <PlayIcon />}
            {task.enabled ? "Pause" : "Resume"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={busy || !canOperate} onClick={() => void deleteTask()}>
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

function taskStatusLabel(task: ScheduledTask): string {
  const schedule = scheduleLabel(task.schedule);
  if (!task.enabled) return `${schedule} · paused`;
  if (task.lastRunStatus === "running") return `${schedule} · running`;
  if (task.lastRunStatus === "failed") return `${schedule} · last run failed`;
  if (task.schedule.type === "webhook" || task.nextRunAt === null) return schedule;
  return `${schedule} · next ${relativeLabel(task.nextRunAt)}`;
}
