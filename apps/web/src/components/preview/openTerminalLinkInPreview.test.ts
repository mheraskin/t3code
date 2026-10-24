import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { openTerminalLinkInPreview } from "./openTerminalLinkInPreview";

vi.mock("~/previewStateStore", () => ({
  applyPreviewServerSnapshot: vi.fn(),
  isPreviewSupportedInRuntime: () => true,
}));

vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ openBrowser: vi.fn() }),
  },
}));

const gatewayMocks = vi.hoisted(() => ({
  resolve: vi.fn<() => Promise<string | null>>(async () => null),
}));

vi.mock("~/browser/previewGateway", () => ({
  resolvePreviewGatewayUrl: gatewayMocks.resolve,
}));

const openGateway = vi.fn();

const browserDefaultsMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("~/browser/browserDefaults", () => ({
  resolveBrowserDefaults: browserDefaultsMocks.resolve,
  browserDefaultOpenViewport: (defaults: { viewport: unknown }) => defaults.viewport,
  browserDefaultOpenProfileId: (defaults: { profileId: string }) => defaults.profileId,
}));

const linkTargetMocks = vi.hoisted(() => ({
  preference: vi.fn<() => "system" | "app">(),
}));

vi.mock("~/browser/browserLinkTarget", () => ({
  resolveBrowserLinkTargetPreference: async () => linkTargetMocks.preference(),
  isWebUrl: (url: string) => /^https?:/u.test(url),
}));

const hydratedDefaults = {
  viewport: { _tag: "fixed", width: 1280, height: 720 } as const,
  profileId: "work",
};

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-20T00:00:00.000Z",
};

beforeEach(() => {
  gatewayMocks.resolve.mockReset();
  gatewayMocks.resolve.mockResolvedValue(null);
  browserDefaultsMocks.resolve.mockReset();
  browserDefaultsMocks.resolve.mockResolvedValue(hydratedDefaults);
  linkTargetMocks.preference.mockReturnValue("app");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTerminalLinkInPreview", () => {
  it("does not report or fall back when opening the preview is interrupted", async () => {
    const fallbackToBrowser = vi.fn();
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await openTerminalLinkInPreview({
      url: "http://localhost:5173/",
      threadRef,
      openPreview: async () => AsyncResult.failure(Cause.interrupt()),
      openGateway,
      fallbackToBrowser,
      forceBrowser: false,
    });

    expect(reportError).not.toHaveBeenCalled();
    expect(fallbackToBrowser).not.toHaveBeenCalled();
  });

  it("opens loopback links through the preview gateway when it applies", async () => {
    gatewayMocks.resolve.mockResolvedValue("http://100.99.182.95:8971/?t3PreviewGatewayToken=t");
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));

    await openTerminalLinkInPreview({
      url: "http://localhost:8971/",
      threadRef,
      openPreview,
      openGateway,
      fallbackToBrowser: vi.fn(),
      forceBrowser: false,
    });

    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          url: "http://100.99.182.95:8971/?t3PreviewGatewayToken=t",
        }),
      }),
    );
  });
});
