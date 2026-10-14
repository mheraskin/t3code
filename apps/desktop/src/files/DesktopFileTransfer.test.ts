import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { beforeEach, vi } from "vite-plus/test";
import * as DesktopFileTransfer from "./DesktopFileTransfer.ts";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Owns an isolated loopback download fixture.
import * as NodeHttp from "node:http";

const mocks = vi.hoisted(() => ({
  startDrag: vi.fn<(input: { file: string; icon: unknown }) => void>(),
  saveDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getFileIcon: async () => "icon" },
  webContents: { fromId: () => ({ isDestroyed: () => false, startDrag: mocks.startDrag }) },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: mocks.saveDialog },
  nativeImage: { createFromDataURL: () => ({ resize: () => "icon" }) },
}));

const layer = DesktopFileTransfer.layer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(NodeHttpClient.layerUndici),
);
const bytes = Uint8Array.from([0, 255, 128, 13, 10, 42]);

beforeEach(() => {
  mocks.startDrag.mockClear();
  mocks.saveDialog.mockReset();
});

describe("DesktopFileTransfer", () => {
  it.effect("streams a remote file into a local temporary file without changing its bytes", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.tryPromise(
          () =>
            new Promise<NodeHttp.Server>((resolve, reject) => {
              const server = NodeHttp.createServer((_request, response) => {
                response.write(bytes.subarray(0, 2));
                response.end(bytes.subarray(2));
              });
              server.once("error", reject);
              server.listen(0, "127.0.0.1", () => resolve(server));
            }),
        ),
        (server) =>
          Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected loopback address");
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      const fs = yield* FileSystem.FileSystem;
      const id = yield* files.prepare(
        {
          name: "remote.zip",
          source: {
            _tag: "url",
            url: `http://127.0.0.1:${address.port}/remote.zip`,
          },
        },
        7,
      );
      yield* files.startDrag(id, 7);
      const filePath = mocks.startDrag.mock.calls[0]?.[0].file;
      if (!filePath) throw new Error("Expected a staged file");
      expect(Array.from(yield* fs.readFile(filePath))).toEqual(Array.from(bytes));
      expect(filePath).toContain("t3-file-transfer-");
    }).pipe(Effect.provide(layer)),
  );
  it.effect(
    "stages exact bytes in separate directories and preserves the filename for native drops",
    () =>
      Effect.gen(function* () {
        const files = yield* DesktopFileTransfer.DesktopFileTransfer;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const input = { name: "../report.zip", source: { _tag: "bytes" as const, bytes } };
        const first = yield* files.prepare(input, 7);
        const second = yield* files.prepare(input, 7);
        yield* files.startDrag(first, 7);
        yield* files.startDrag(second, 7);
        const paths = mocks.startDrag.mock.calls.map(([item]) => item.file);
        expect(paths).toHaveLength(2);
        expect(paths[0]).not.toBe(paths[1]);
        for (const filePath of paths) {
          expect(path.basename(filePath)).toBe("report.zip");
          expect(Array.from(yield* fs.readFile(filePath))).toEqual(Array.from(bytes));
        }
        const wrongOwner = yield* files.startDrag(first, 8).pipe(Effect.flip);
        expect(wrongOwner._tag).toBe("DesktopFileTransferError");
      }).pipe(Effect.provide(layer)),
  );

  it.effect("writes a copy to the selected destination and leaves cancellation untouched", () =>
    Effect.gen(function* () {
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-save-destination-" });
      const destination = path.join(directory, "renamed.zip");
      yield* fs.writeFileString(destination, "existing file");
      const input = { name: "report.zip", source: { _tag: "bytes" as const, bytes } };
      mocks.saveDialog.mockResolvedValueOnce({ canceled: true });
      expect(yield* files.save(input, 7)).toBe(false);
      expect(yield* fs.readFileString(destination)).toBe("existing file");
      mocks.saveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
      expect(yield* files.save(input, 7)).toBe(true);
      expect(Array.from(yield* fs.readFile(destination))).toEqual(Array.from(bytes));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects non-HTTP sources without exposing a local file to the renderer", () =>
    Effect.gen(function* () {
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      for (const url of ["file:///etc/passwd", "not a URL"]) {
        const error = yield* files
          .prepare({ name: "file", source: { _tag: "url", url } }, 7)
          .pipe(Effect.flip);
        expect(error._tag).toBe("DesktopFileTransferError");
      }
    }).pipe(Effect.provide(layer)),
  );
});
