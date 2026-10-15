import { create } from "zustand";

import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";

/** What the main-screen scheduled task dialog is open on. */
export interface ScheduledTaskEditorTarget {
  /** Null lets the dialog pick the primary connected environment. */
  readonly environmentId: EnvironmentId | null;
  /** Null creates a new task. */
  readonly task: ScheduledTask | null;
}

interface ScheduledTaskEditorStoreState {
  target: ScheduledTaskEditorTarget | null;
  openNew: (environmentId?: EnvironmentId | null) => void;
  openEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
  close: () => void;
}

/**
 * Lets the sidebar shelf and the command palette open the scheduled task
 * dialog over whatever screen is showing, instead of sending the user to
 * Settings. `ScheduledTaskEditorHost` renders it.
 */
export const useScheduledTaskEditorStore = create<ScheduledTaskEditorStoreState>()((set) => ({
  target: null,
  openNew: (environmentId = null) => set({ target: { environmentId, task: null } }),
  openEdit: (environmentId, task) => set({ target: { environmentId, task } }),
  close: () => set({ target: null }),
}));
