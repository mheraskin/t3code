import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
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
  return <button {...transfer.dragProps} />;
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.start.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      desktopBridge: { prepareFileDrag: mocks.prepare, startFileDrag: mocks.start },
    }),
  );
});
afterEach(async () => {
  if (renderer) await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("never starts a delayed native drag after release, and reuses the prepared file for the next drag", async () => {
  let complete: (id: string) => void = () => {};
  mocks.prepare.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve;
    }),
  );
  await act(() => {
    renderer = create(<Probe />);
  });
  const button = renderer?.root.findByType("button");
  if (!button) throw new Error("Expected transfer control");
  await act(() => button.props.onPointerDown({ button: 0 }));
  expect(mocks.prepare).not.toHaveBeenCalled();
  await act(() =>
    button.props.onDragStart({ preventDefault: () => {}, stopPropagation: () => {} }),
  );
  window.dispatchEvent(new Event("pointerup"));
  await act(async () => complete("prepared-file"));
  expect(mocks.start).not.toHaveBeenCalled();

  await act(() => button.props.onPointerDown({ button: 0 }));
  await act(() =>
    button.props.onDragStart({ preventDefault: () => {}, stopPropagation: () => {} }),
  );
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith("prepared-file");
});
