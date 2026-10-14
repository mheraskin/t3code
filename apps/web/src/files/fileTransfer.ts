import type { DesktopFileSource } from "@t3tools/contracts";

declare global {
  interface Window {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
      createWritable: () => Promise<{
        write: (blob: Blob) => Promise<void>;
        close: () => Promise<void>;
        abort: () => Promise<void>;
      }>;
    }>;
  }
}

async function readDownloadResponse(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The file could not be downloaded (HTTP ${response.status}).`);
  return response;
}

async function readSourceBlob(source: DesktopFileSource): Promise<Blob> {
  return source._tag === "bytes"
    ? new Blob([new Uint8Array(source.bytes)])
    : (await readDownloadResponse(source.url)).blob();
}

/** Start the local picker in the click gesture, before authorizing or reading remote bytes. */
export async function saveFileOnDevice(name: string, readSource: () => Promise<DesktopFileSource>) {
  if (window.desktopBridge?.saveFile) {
    return window.desktopBridge.saveFile({ name, source: await readSource() });
  }
  const destination = window.showSaveFilePicker?.({ suggestedName: name });
  try {
    const handle = await destination;
    const source = await readSource();
    if (handle) {
      const response = source._tag === "url" ? await readDownloadResponse(source.url) : null;
      const writable = await handle.createWritable();
      try {
        if (response?.body && writable instanceof WritableStream) {
          await response.body.pipeTo(writable);
        } else {
          const blob = response ? await response.blob() : await readSourceBlob(source);
          await writable.write(blob);
          await writable.close();
        }
      } catch (cause) {
        await writable.abort().catch(() => undefined);
        throw cause;
      }
    } else {
      const blob = await readSourceBlob(source);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    return true;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return false;
    throw cause;
  }
}
