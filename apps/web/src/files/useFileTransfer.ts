import type { AssetResource, DesktopFileSource, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { readLocalApi } from "~/localApi";
import { toastManager } from "~/components/ui/toast";
import { saveFileOnDevice } from "./fileTransfer";

export type FileTransferSource =
  | { kind: "asset"; environmentId: EnvironmentId; resource: AssetResource }
  | { kind: "blob"; file: Blob };

export function workspaceFileTransferSource(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
): FileTransferSource {
  return {
    kind: "asset",
    environmentId,
    resource: { _tag: "draft-workspace-file", cwd, path, disposition: "attachment" },
  };
}

/** Saves and drags original bytes onto the client machine, regardless of their environment. */
export function useFileTransfer(name: string, source: FileTransferSource | null) {
  const refresh = useAssetUrlRefresh(
    source?.kind === "asset" ? source.environmentId : null,
    source?.kind === "asset" ? source.resource : null,
  );
  const [saving, setSaving] = useState(false);
  const gesture = useRef<AbortController | null>(null);
  const prepared = useRef<{
    read: () => Promise<DesktopFileSource>;
    promise: Promise<string>;
  } | null>(null);
  const browserUrl = useRef<{ read: () => Promise<DesktopFileSource>; url: string } | null>(null);
  // The React Compiler keeps `read` stable per source, which the drag caches below compare against.
  const read = async (): Promise<DesktopFileSource> => {
    if (source?.kind === "blob") {
      return { _tag: "bytes", bytes: new Uint8Array(await source.file.arrayBuffer()) };
    }
    const url = await refresh();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    return { _tag: "url", url };
  };
  useEffect(() => () => gesture.current?.abort(), []);
  const localFile = source?.kind === "blob" ? source.file : null;
  useEffect(() => {
    if (!localFile || typeof window === "undefined" || window.desktopBridge?.prepareFileDrag)
      return;
    const url = URL.createObjectURL(localFile);
    browserUrl.current = { read, url };
    return () => URL.revokeObjectURL(url);
  }, [localFile, read]);

  const reportFailure = (title: string, cause: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: cause instanceof Error ? cause.message : "Please try again.",
    });
  };

  const save = async () => {
    if (!source || saving) return;
    setSaving(true);
    await saveFileOnDevice(name, read).catch((cause: unknown) =>
      reportFailure("Could not save file", cause),
    );
    setSaving(false);
  };

  const onPointerDown = (event: { button: number }) => {
    if (event.button !== 0 || !source) return;
    gesture.current?.abort();
    const controller = new AbortController();
    gesture.current = controller;
    const released = () => controller.abort();
    window.addEventListener("pointerup", released, {
      once: true,
      capture: true,
      signal: controller.signal,
    });
    window.addEventListener("blur", released, { once: true, signal: controller.signal });
    if (!window.desktopBridge?.prepareFileDrag && source.kind === "asset") {
      // A browser's DataTransfer can only be filled synchronously during dragstart.
      void read()
        .then((value) => {
          if (value._tag === "url") browserUrl.current = { read, url: value.url };
        })
        .catch(() => undefined);
    }
  };

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    if (!source) return;
    event.stopPropagation();
    const bridge = window.desktopBridge;
    const prepareFileDrag = bridge?.prepareFileDrag;
    const startFileDrag = bridge?.startFileDrag;
    if (prepareFileDrag && startFileDrag) {
      event.preventDefault();
      const controller = gesture.current;
      if (!controller || controller.signal.aborted) return;
      let preparation = prepared.current;
      if (!preparation || preparation.read !== read) {
        preparation = {
          read,
          promise: read().then((value) => prepareFileDrag({ name, source: value })),
        };
        prepared.current = preparation;
      }
      const toast = toastManager.add({ type: "loading", title: "Preparing file to drag…" });
      void preparation.promise
        .then(async (id) => {
          if (controller.signal.aborted) {
            toastManager.update(toast, {
              type: "info",
              title: "File is ready. Drag it again to copy it.",
            });
            return;
          }
          prepared.current = null;
          await startFileDrag(id);
          toastManager.close(toast);
        })
        .catch((cause: unknown) => {
          prepared.current = null;
          toastManager.close(toast);
          reportFailure("Could not drag file", cause);
        });
      return;
    }
    const url = browserUrl.current?.read === read ? browserUrl.current.url : null;
    if (url) {
      event.dataTransfer.clearData();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        "DownloadURL",
        `application/octet-stream:${name.replaceAll(":", "_")}:${url}`,
      );
    } else {
      event.preventDefault();
      toastManager.add({ type: "info", title: "Use Download to save this file on your device." });
    }
  };

  const onContextMenu = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
    clientX: number;
    clientY: number;
    currentTarget?: HTMLElement;
  }) => {
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget?.getBoundingClientRect();
    const position =
      event.clientX === 0 && event.clientY === 0 && bounds
        ? { x: bounds.left, y: bounds.bottom }
        : { x: event.clientX, y: event.clientY };
    void readLocalApi()
      ?.contextMenu.show([{ id: "download", label: "Download…", icon: "download" }], position)
      .then((action) => {
        if (action === "download") void save();
      })
      .catch((cause: unknown) => reportFailure("Could not open file menu", cause));
  };

  return {
    save,
    saving,
    onContextMenu,
    dragProps: { draggable: source !== null, onPointerDown, onDragStart },
  };
}

export function useWorkspaceFileTransfer(
  environmentId: EnvironmentId | null,
  cwd: string | undefined,
  path: string | null,
) {
  const source =
    environmentId && path && cwd ? workspaceFileTransferSource(environmentId, cwd, path) : null;
  const name = path?.split(/[\\/]/).at(-1) ?? "file";
  return useFileTransfer(name, source);
}
