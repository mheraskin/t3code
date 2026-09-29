import type { DiscoveredLocalServer, ScopedThreadRef } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import { resolvePreviewGatewayUrl, type OpenPreviewGateway } from "~/browser/previewGateway";
import { recordVisitForThread } from "~/browserHistoryStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openPreviewSession } from "./openPreviewSession";

export async function openDiscoveredPort<E, GE>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly port: DiscoveredLocalServer;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly openGateway: OpenPreviewGateway<GE>;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  const environmentId = input.threadRef.environmentId;
  const resolvedUrl =
    (await resolvePreviewGatewayUrl(environmentId, input.port.url, input.openGateway)) ??
    resolveDiscoveredServerUrl(environmentId, input.port.url);
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: resolvedUrl,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    recordVisitForThread(input.threadRef, input.port.url);
    useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
  });
}
