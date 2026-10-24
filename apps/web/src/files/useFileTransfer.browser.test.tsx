import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../test/render";
import { useFileTransfer, type FileTransferSource } from "./useFileTransfer";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn() }));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlRefresh: () => async () => "https://remote.test/signed-file",
}));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: vi.fn(), update: vi.fn(), close: vi.fn() },
}));
vi.mock("~/localApi", () => ({ readLocalApi: () => undefined }));

const source: FileTransferSource = {
  kind: "asset",
  environmentId: EnvironmentId.make("remote"),
  resource: {
    _tag: "draft-workspace-file",
    cwd: "/remote",
    path: "report.zip",
    disposition: "attachment",
  },
};
function Probe() {
  const transfer = useFileTransfer("report.zip", source);
  return <button type="button" {...transfer.dragProps} />;
}

it("never starts a delayed native drag after release, and reuses the prepared file for the next drag", async () => {
  using _bridge = stubGlobal("desktopBridge", {
    prepareFileDrag: mocks.prepare,
    startFileDrag: mocks.start,
  });
  mocks.start.mockResolvedValue(undefined);
  let complete: (id: string) => void = () => {};
  mocks.prepare.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve;
    }),
  );
  await using screen = await render(<Probe />, { router: false });
  const button = screen.container.querySelector("button");
  if (!button) throw new Error("Expected transfer control");
  const pointerDown = () =>
    act(() => {
      button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    });
  const dragStart = () =>
    act(() => {
      button.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
    });

  await pointerDown();
  expect(mocks.prepare).not.toHaveBeenCalled();
  await dragStart();
  window.dispatchEvent(new PointerEvent("pointerup"));
  await act(async () => complete("prepared-file"));
  expect(mocks.start).not.toHaveBeenCalled();

  await pointerDown();
  await dragStart();
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith("prepared-file");
});
