import { DesktopFileTransferInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopFileTransfer from "../../files/DesktopFileTransfer.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const prepareFileDrag = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREPARE_FILE_DRAG_CHANNEL,
  payload: DesktopFileTransferInput,
  result: Schema.String,
  handler: (input, event) =>
    Effect.gen(function* () {
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      return yield* files.prepare(input, event?.sender.id ?? -1);
    }),
});

export const saveFile = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SAVE_FILE_CHANNEL,
  payload: DesktopFileTransferInput,
  result: Schema.Boolean,
  handler: (input, event) =>
    Effect.gen(function* () {
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      return yield* files.save(input, event?.sender.id ?? -1);
    }),
});

export const startFileDrag = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.START_FILE_DRAG_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: (id, event) =>
    Effect.gen(function* () {
      const files = yield* DesktopFileTransfer.DesktopFileTransfer;
      return yield* files.startDrag(id, event?.sender.id ?? -1);
    }),
});
