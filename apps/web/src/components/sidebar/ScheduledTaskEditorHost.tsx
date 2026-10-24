import { useEffect } from "react";

import { useScheduledTaskEditorStore } from "../../scheduledTaskEditorStore";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { ScheduledTaskEditorDialog } from "../settings/ScheduledTasksSettings";

/**
 * Mounts the scheduled task dialog once for the whole window, so it opens
 * over the current screen from the sidebar or the command palette. Unlike the
 * settings page it has no project scope: every project is offered.
 */
export function ScheduledTaskEditorHost() {
  const target = useScheduledTaskEditorStore((state) => state.target);
  const close = useScheduledTaskEditorStore((state) => state.close);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connectedEnvironments = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const environmentId =
    target?.environmentId ??
    (
      connectedEnvironments.find(
        (environment) => environment.environmentId === primaryEnvironmentId,
      ) ?? connectedEnvironments[0]
    )?.environmentId ??
    null;
  // Nothing is connected to create a task on; drop the request rather than
  // have the dialog pop up whenever an environment connects later.
  useEffect(() => {
    if (target && environmentId === null) close();
  }, [close, environmentId, target]);
  if (!target || environmentId === null) return null;
  return (
    <ScheduledTaskEditorDialog
      key={`${environmentId}:${target.task?.id ?? "new"}`}
      initialEnvironmentId={environmentId}
      task={target.task}
      scope={null}
      connectedEnvironments={connectedEnvironments}
      onClose={close}
    />
  );
}
