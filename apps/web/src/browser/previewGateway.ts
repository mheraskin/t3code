import {
  PREVIEW_GATEWAY_TOKEN_QUERY_PARAM,
  type BrowserNavigationTarget,
  type EnvironmentId,
  type PreviewOpenGatewayInput,
  type PreviewOpenGatewayResult,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { isTailscaleHost } from "@t3tools/shared/hostClassification";
import { isLoopbackHost, normalizePreviewUrl } from "@t3tools/shared/preview";

import { readPreparedConnection } from "~/state/session";

export type OpenPreviewGateway<E> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenGatewayInput;
}) => Promise<AtomCommandResult<PreviewOpenGatewayResult, E>>;

/** The environment-side URL a navigation target names. */
export function navigationTargetUrl(target: BrowserNavigationTarget): string {
  if (target.kind === "url") return target.url;
  const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
  return `${target.protocol ?? "http"}://localhost:${target.port}${path}`;
}

/** The loopback port a URL should reach through the gateway, when the environment is on the tailnet. */
export function previewGatewayTarget(
  environmentHttpBaseUrl: string,
  rawUrl: string,
): { readonly port: number; readonly url: URL } | null {
  try {
    const environmentHost = new URL(environmentHttpBaseUrl).hostname;
    if (!isTailscaleHost(environmentHost)) return null;
    const target = new URL(normalizePreviewUrl(rawUrl));
    if (target.protocol !== "http:" || !isLoopbackHost(target.hostname)) return null;
    const port = Number(target.port || 80);
    const url = new URL(
      `${target.pathname}${target.search}${target.hash}`,
      "http://gateway.invalid",
    );
    url.host = `${environmentHost}:${port}`;
    return { port, url };
  } catch {
    return null;
  }
}

/**
 * Opens a loopback URL on a Tailscale-connected environment through its
 * preview gateway. Returns null when the gateway does not apply or is
 * unavailable, so callers keep their direct resolution.
 */
export async function resolvePreviewGatewayUrl<E>(
  environmentId: EnvironmentId,
  rawUrl: string,
  openGateway: OpenPreviewGateway<E>,
): Promise<string | null> {
  const connection = readPreparedConnection(environmentId);
  if (!connection) return null;
  const target = previewGatewayTarget(connection.httpBaseUrl, rawUrl);
  if (!target) return null;
  const result = await openGateway({ environmentId, input: { port: target.port } });
  if (result._tag !== "Success") return null;
  target.url.searchParams.set(PREVIEW_GATEWAY_TOKEN_QUERY_PARAM, result.value.token);
  return target.url.toString();
}
