import type { DesktopFileTransferInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import * as Electron from "electron";

export class DesktopFileTransferError extends Schema.TaggedError<DesktopFileTransferError>()(
  "DesktopFileTransferError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `Could not ${this.operation} file on this device.`;
  }
}

export class DesktopFileTransfer extends Context.Service<
  DesktopFileTransfer,
  {
    readonly prepare: (
      input: DesktopFileTransferInput,
      senderId: number,
    ) => Effect.Effect<string, DesktopFileTransferError>;
    readonly save: (
      input: DesktopFileTransferInput,
      senderId: number,
    ) => Effect.Effect<boolean, DesktopFileTransferError>;
    readonly startDrag: (
      id: string,
      senderId: number,
    ) => Effect.Effect<void, DesktopFileTransferError>;
  }
>()("@t3tools/desktop/files/DesktopFileTransfer") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  // Targets may read the file after the drop completes. Keep drag files until app shutdown.
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-file-transfer-" });
  const prepared = new Map<
    string,
    { path: string; senderId: number; icon: Electron.NativeImage }
  >();
  let sequence = 0;

  const prepare = Effect.fn("DesktopFileTransfer.prepare")(function* (
    input: DesktopFileTransferInput,
    senderId: number,
  ) {
    const name = input.name
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[\p{Cc}]/gu, "_");
    if (!name || name === "." || name === "..") {
      return yield* new DesktopFileTransferError({
        operation: "prepare",
        cause: "Invalid filename",
      });
    }
    const id = String(++sequence);
    const directory = path.join(root, id);
    const filePath = path.join(directory, name);
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory);
      if (input.source._tag === "bytes") {
        yield* fs.writeFile(filePath, input.source.bytes);
      } else {
        const sourceUrl = input.source.url;
        const url = yield* Effect.try(() => new URL(sourceUrl));
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return yield* Effect.fail("Invalid download URL");
        }
        const response = yield* http.get(url.href);
        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(`Download failed with HTTP ${response.status}`);
        }
        yield* Stream.run(response.stream, fs.sink(filePath));
      }
    }).pipe(
      Effect.scoped,
      Effect.tapError(() => fs.remove(directory, { recursive: true }).pipe(Effect.ignore)),
      Effect.mapError((cause) => new DesktopFileTransferError({ operation: "prepare", cause })),
    );
    const icon = yield* Effect.tryPromise(() =>
      Electron.app.getFileIcon(filePath, { size: "normal" }),
    ).pipe(
      Effect.orElseSucceed(() =>
        Electron.nativeImage
          .createFromDataURL(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          )
          .resize({ width: 32, height: 32 }),
      ),
    );
    prepared.set(id, { path: filePath, senderId, icon });
    return id;
  });

  const save = Effect.fn("DesktopFileTransfer.save")(function* (
    input: DesktopFileTransferInput,
    senderId: number,
  ) {
    const result = yield* Effect.tryPromise(() => {
      const sender = Electron.webContents.fromId(senderId);
      const owner = sender ? Electron.BrowserWindow.fromWebContents(sender) : null;
      const options = { defaultPath: input.name.split(/[\\/]/).at(-1) ?? "file" };
      return owner
        ? Electron.dialog.showSaveDialog(owner, options)
        : Electron.dialog.showSaveDialog(options);
    }).pipe(Effect.mapError((cause) => new DesktopFileTransferError({ operation: "save", cause })));
    if (result.canceled || !result.filePath) return false;
    const id = yield* prepare(input, senderId);
    const file = prepared.get(id);
    if (!file) return false;
    return yield* Effect.gen(function* () {
      yield* fs.copyFile(file.path, result.filePath);
      return true;
    }).pipe(
      Effect.mapError((cause) => new DesktopFileTransferError({ operation: "save", cause })),
      Effect.ensuring(
        fs
          .remove(path.dirname(file.path), { recursive: true })
          .pipe(Effect.ignore, Effect.andThen(Effect.sync(() => prepared.delete(id)))),
      ),
    );
  });

  const startDrag = Effect.fn("DesktopFileTransfer.startDrag")((id: string, senderId: number) =>
    Effect.try({
      try: () => {
        const file = prepared.get(id);
        const sender = Electron.webContents.fromId(senderId);
        if (!file || file.senderId !== senderId || !sender || sender.isDestroyed()) {
          throw new Error("The prepared file is unavailable.");
        }
        sender.startDrag({ file: file.path, icon: file.icon });
      },
      catch: (cause) => new DesktopFileTransferError({ operation: "drag", cause }),
    }),
  );
  return DesktopFileTransfer.of({ prepare, save, startDrag });
});

export const layer = Layer.effect(DesktopFileTransfer, make);
