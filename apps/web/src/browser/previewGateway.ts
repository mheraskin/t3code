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

interface PreviewGatewayTarget {
  readonly port: number;
  /** Tenant-style subdomain, from `<sub>.localhost` or `<sub>.<machine>`. */
  readonly subdomain: string | null;
  readonly environmentHost: string;
  readonly path: string;
}

const LOCALHOST_SUFFIX = ".localhost";

/** Machine names learned from each environment's gateway, e.g. `xps`. */
const gatewayHostnames = new Map<EnvironmentId, string>();

/**
 * The environment-side port a URL should reach through the gateway, when the
 * environment is on the tailnet. Accepts loopback URLs, `<sub>.localhost`, and
 * hosts under the environment's own address or machine name.
 */
export function previewGatewayTarget(
  environmentHttpBaseUrl: string,
  rawUrl: string,
  gatewayHostname?: string,
): PreviewGatewayTarget | null {
  try {
    const environmentHost = new URL(environmentHttpBaseUrl).hostname;
    if (!isTailscaleHost(environmentHost)) return null;
    const target = new URL(normalizePreviewUrl(rawUrl));
    if (target.protocol !== "http:") return null;
    const host = target.hostname.toLowerCase();
    let subdomain: string | null;
    if (isLoopbackHost(host) || host === environmentHost || host === gatewayHostname) {
      subdomain = null;
    } else if (host.endsWith(LOCALHOST_SUFFIX)) {
      subdomain = host.slice(0, -LOCALHOST_SUFFIX.length);
    } else if (gatewayHostname && host.endsWith(`.${gatewayHostname}`)) {
      subdomain = host.slice(0, -(gatewayHostname.length + 1));
    } else {
      return null;
    }
    return {
      port: Number(target.port || 80),
      subdomain,
      environmentHost,
      path: `${target.pathname}${target.search}${target.hash}`,
    };
  } catch {
    return null;
  }
}

/** Prefers the machine name so tenant subdomains resolve; an IP cannot carry one. */
export function previewGatewayUrl(
  target: PreviewGatewayTarget,
  token: string,
  gatewayHostname?: string,
): string {
  const base = gatewayHostname ?? target.environmentHost;
  const host = target.subdomain && gatewayHostname ? `${target.subdomain}.${base}` : base;
  const url = new URL(target.path, `http://${host}:${target.port}`);
  url.searchParams.set(PREVIEW_GATEWAY_TOKEN_QUERY_PARAM, token);
  return url.toString();
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
  const target = previewGatewayTarget(
    connection.httpBaseUrl,
    rawUrl,
    gatewayHostnames.get(environmentId),
  );
  if (!target) return null;
  const result = await openGateway({ environmentId, input: { port: target.port } });
  if (result._tag !== "Success") return null;
  const { token, hostname } = result.value;
  if (hostname) gatewayHostnames.set(environmentId, hostname);
  return previewGatewayUrl(target, token, hostname);
}
