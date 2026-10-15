/**
 * The sidebar's scheduled tasks shelf: every task on every connected
 * environment, above the thread list. Collapsed by default and absent when
 * there are no tasks, so it costs nothing to users who never schedule work.
 *
 * A row opens the thread its runs post into, or the task's settings when runs
 * launch fresh threads. While collapsed, the header still counts the tasks and
 * flags any whose last run failed.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClockIcon } from "lucide-react";
import { useMemo } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { relativeLabel, scheduleLabel } from "../settings/ScheduledTasksSettings";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { SidebarMenuButton } from "../ui/sidebar";

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
  const [expanded, setExpanded] = useLocalStorage(
    SCHEDULED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  if (tasks.length === 0) return null;
  const failedCount = tasks.filter(({ task }) => task.lastRunStatus === "failed").length;
  return (
    <section aria-label="Scheduled tasks" className="mx-0.5 mb-1">
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
      {expanded ? <ScheduledTaskList tasks={tasks} /> : null}
    </section>
  );
}

// Split out so the minute tick that keeps "next in 5m" honest only runs while
// the list is open.
function ScheduledTaskList({ tasks }: { tasks: readonly EnvironmentScheduledTask[] }) {
  useRelativeTimeTick(60_000);
  const navigate = useNavigate();
  return (
    <ul className="flex flex-col gap-px">
      {tasks.map(({ environmentId, task }) => (
        <li key={`${environmentId}:${task.id}`}>
          <SidebarMenuButton
            className="h-auto"
            title={task.prompt}
            onClick={() =>
              void (task.threadId
                ? navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(environmentId, task.threadId)),
                  })
                : navigate({
                    to: "/settings/scheduled-tasks",
                    search: { environmentId, taskId: task.id },
                  }))
            }
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
        </li>
      ))}
    </ul>
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
