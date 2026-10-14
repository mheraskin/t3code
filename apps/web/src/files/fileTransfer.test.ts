import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { saveFileOnDevice } from "./fileTransfer";

afterEach(() => vi.unstubAllGlobals());

describe("saving files on the client device", () => {
  it("streams remote bytes to the chosen browser destination", async () => {
    const chunks: Uint8Array[] = [];
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(chunk);
      },
    });
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => ({ createWritable: async () => writable }),
    });
    const response = new Response(Uint8Array.from([0, 255, 128, 42]));
    const blob = vi.spyOn(response, "blob");
    vi.stubGlobal("fetch", async () => response);
    expect(
      await saveFileOnDevice("report.zip", async () => ({
        _tag: "url",
        url: "https://remote.test/file",
      })),
    ).toBe(true);
    expect(chunks.flatMap((chunk) => Array.from(chunk))).toEqual([0, 255, 128, 42]);
    expect(blob).not.toHaveBeenCalled();
  });
  it("opens the browser destination picker before remote authorization and preserves binary bytes", async () => {
    const order: string[] = [];
    const destination: { blob: Blob | null } = { blob: null };
    const writable = {
      write: async (blob: Blob) => {
        destination.blob = blob;
      },
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => {
        order.push("picker");
        return { createWritable: async () => writable };
      },
    });
    const bytes = Uint8Array.from([0, 255, 128, 42]);
    vi.stubGlobal("fetch", async () => new Response(bytes));
    expect(
      await saveFileOnDevice("report.zip", async () => {
        order.push("authorize");
        return { _tag: "url", url: "https://remote.test/file" };
      }),
    ).toBe(true);
    expect(order).toEqual(["picker", "authorize"]);
    expect(destination.blob).not.toBeNull();
    // The destination stores the original bytes rather than the rendered preview text.
    const blob = destination.blob;
    expect(blob && new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it("does not download a remote file after the destination picker is cancelled", async () => {
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
    const read = vi.fn(async () => ({ _tag: "url" as const, url: "https://remote.test/file" }));
    expect(await saveFileOnDevice("report.zip", read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("aborts the destination on a failed write", async () => {
    const abort = vi.fn(async () => {});
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => {
            throw new Error("Disk full");
          },
          close: async () => {},
          abort,
        }),
      }),
    });
    await expect(
      saveFileOnDevice("file.txt", async () => ({ _tag: "bytes", bytes: new Uint8Array([42]) })),
    ).rejects.toThrow("Disk full");
    expect(abort).toHaveBeenCalledOnce();
  });
});
