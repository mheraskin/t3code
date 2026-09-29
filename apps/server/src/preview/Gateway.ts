// @effect-diagnostics nodeBuiltinImport:off - raw sockets are needed to relay WebSocket upgrades
// @effect-diagnostics globalDate:off - token checks run inside Node request callbacks
/**
 * Tailscale preview gateway.
 *
 * Dev servers usually bind loopback, so a client on another tailnet device
 * cannot reach them even though discovery lists them. For a discovered port
 * the gateway listens on this machine's Tailscale addresses at the same port
 * number and reverse-proxies HTTP and WebSocket traffic to `localhost:<port>`.
 * Keeping the port number means the client's URL rewrite and any absolute
 * `host:port` URLs the app emits (Vite HMR, redirects) keep working.
 *
 * Access is a signed, port-scoped token minted over the authenticated RPC.
 * The first request trades it for a cookie on the gateway origin. T3's own
 * cookies are host-scoped and therefore reach the gateway too; they are
 * stripped before anything is forwarded to the dev server.
 *
 * Only Tailscale addresses are bound, never the LAN. A listener closes when its
 * upstream refuses a connection so a stopped dev server gets its port back.
 */
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOs from "node:os";

import {
  PREVIEW_GATEWAY_TOKEN_QUERY_PARAM,
  PreviewGatewayUnavailableError,
} from "@t3tools/contracts";
import { isTailscaleIpv4Address } from "@t3tools/tailscale";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import { PortDiscovery } from "./PortScanner.ts";

export class PreviewGateway extends Context.Service<
  PreviewGateway,
  {
    /** Ensures the gateway serves `port` and returns a short-lived access token for it. */
    readonly open: (
      port: number,
    ) => Effect.Effect<{ readonly token: string }, PreviewGatewayUnavailableError>;
  }
>()("t3/preview/Gateway/PreviewGateway") {}

const SIGNING_SECRET_NAME = "preview-gateway-signing-key";
/** The URL token only has to survive the client navigating to it. */
const URL_TOKEN_TTL_MS = 2 * 60 * 1000;
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000;
const T3_COOKIE_PREFIX = "t3_";

const GatewayClaims = Schema.fromJsonString(
  Schema.Struct({ port: Schema.Number, expiresAt: Schema.Number }),
);
const decodeClaims = Schema.decodeUnknownOption(GatewayClaims);
const encodeClaims = Schema.encodeSync(GatewayClaims);

export const gatewayCookieName = (port: number): string => `t3_preview_gateway_${port}`;

export const signGatewayToken = (
  claims: { readonly port: number; readonly expiresAt: number },
  secret: Uint8Array,
): string => {
  const payload = base64UrlEncode(encodeClaims(claims));
  return `${payload}.${signPayload(payload, secret)}`;
};

export const verifyGatewayToken = (
  token: string,
  port: number,
  secret: Uint8Array,
  nowMillis: number,
): boolean => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!timingSafeEqualBase64Url(signature, signPayload(payload, secret))) return false;
  let decoded: string;
  try {
    decoded = base64UrlDecodeUtf8(payload);
  } catch {
    return false;
  }
  const claims = Option.getOrNull(decodeClaims(decoded));
  return claims !== null && claims.port === port && claims.expiresAt > nowMillis;
};

const readCookie = (header: string | undefined, name: string): string | null => {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
};

/** Drops T3 session and gateway cookies; the dev server keeps its own. */
export const stripT3Cookies = (header: string | undefined): string | undefined => {
  const kept = (header?.split(";") ?? [])
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(T3_COOKIE_PREFIX));
  return kept.length > 0 ? kept.join("; ") : undefined;
};

const upstreamHeaders = (
  headers: NodeHttp.IncomingHttpHeaders,
  port: number,
): NodeHttp.OutgoingHttpHeaders => {
  const { cookie, host, ...rest } = headers;
  const forwardedCookie = stripT3Cookies(cookie);
  return {
    ...rest,
    // Dev servers check Host (Vite's allowedHosts, nginx vhosts); present the
    // request as the local one it replaces.
    host: `localhost:${port}`,
    ...(host ? { "x-forwarded-host": host } : {}),
    "x-forwarded-proto": "http",
    ...(forwardedCookie ? { cookie: forwardedCookie } : {}),
  };
};

/** Points upstream redirects to `localhost:<port>` back at the gateway origin. */
export const rewriteLocation = (
  location: string,
  port: number,
  gatewayHost: string | undefined,
): string => {
  if (!gatewayHost) return location;
  try {
    const url = new URL(location);
    const isUpstream =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
      url.port === String(port);
    if (!isUpstream) return location;
    return `http://${gatewayHost}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return location;
  }
};

export const tailscaleAddresses = (
  interfaces: ReturnType<typeof NodeOs.networkInterfaces> = NodeOs.networkInterfaces(),
): ReadonlyArray<string> =>
  Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address)
    .filter(
      (address) =>
        isTailscaleIpv4Address(address) || address.toLowerCase().startsWith("fd7a:115c:a1e0:"),
    );

interface GatewayHandlers {
  readonly port: number;
  readonly secret: Uint8Array;
  readonly onUpstreamGone: () => void;
}

const isConnectionRefused = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED";

const hasAccess = (request: NodeHttp.IncomingMessage, handlers: GatewayHandlers): boolean => {
  const token = readCookie(request.headers.cookie, gatewayCookieName(handlers.port));
  return token !== null && verifyGatewayToken(token, handlers.port, handlers.secret, Date.now());
};

export const handleGatewayRequest =
  (handlers: GatewayHandlers) =>
  (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse): void => {
    const { port, secret } = handlers;
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    const urlToken = url.searchParams.get(PREVIEW_GATEWAY_TOKEN_QUERY_PARAM);
    if (urlToken !== null) {
      url.searchParams.delete(PREVIEW_GATEWAY_TOKEN_QUERY_PARAM);
      const now = Date.now();
      const tokenValid = verifyGatewayToken(urlToken, port, secret, now);
      // A remembered URL can carry an expired token while the cookie is still good.
      if (tokenValid || hasAccess(request, handlers)) {
        const cookieToken = signGatewayToken({ port, expiresAt: now + COOKIE_TTL_MS }, secret);
        response.writeHead(302, {
          location: `${url.pathname}${url.search}${url.hash}`,
          "cache-control": "no-store",
          ...(tokenValid
            ? {
                "set-cookie": `${gatewayCookieName(port)}=${cookieToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL_MS / 1000}`,
              }
            : {}),
        });
        response.end();
        return;
      }
    }
    if (!hasAccess(request, handlers)) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("Open this preview from T3 Code to access it.");
      return;
    }

    const upstream = NodeHttp.request(
      {
        host: "localhost",
        port,
        method: request.method,
        path: request.url,
        headers: upstreamHeaders(request.headers, port),
      },
      (upstreamResponse) => {
        const headers = { ...upstreamResponse.headers };
        if (typeof headers.location === "string") {
          headers.location = rewriteLocation(headers.location, port, request.headers.host);
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`The dev server on port ${port} is not reachable.`);
      } else {
        response.destroy();
      }
      if (isConnectionRefused(error)) handlers.onUpstreamGone();
    });
    request.pipe(upstream);
  };

export const handleGatewayUpgrade =
  (handlers: GatewayHandlers) =>
  (request: NodeHttp.IncomingMessage, socket: NodeNet.Socket, head: Buffer): void => {
    socket.on("error", () => socket.destroy());
    if (!hasAccess(request, handlers)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = NodeNet.connect({ host: "localhost", port: handlers.port }, () => {
      const headers = upstreamHeaders(request.headers, handlers.port);
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", (error) => {
      socket.destroy();
      if (isConnectionRefused(error)) handlers.onUpstreamGone();
    });
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  };

const listen = (server: NodeHttp.Server, port: number, address: string) =>
  Effect.callback<void, NodeJS.ErrnoException>((resume) => {
    const onError = (error: NodeJS.ErrnoException) => resume(Effect.fail(error));
    server.once("error", onError);
    server.listen(port, address, () => {
      server.off("error", onError);
      resume(Effect.void);
    });
  });

export const make = Effect.gen(function* PreviewGatewayMake() {
  const portDiscovery = yield* PortDiscovery;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const openLock = yield* Semaphore.make(1);
  const listeners = new Map<number, ReadonlyArray<NodeHttp.Server>>();

  const closePort = (port: number) => {
    const servers = listeners.get(port);
    listeners.delete(port);
    for (const server of servers ?? []) {
      server.close();
      server.closeAllConnections();
    }
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const port of [...listeners.keys()]) closePort(port);
    }),
  );

  const unavailable = (port: number, reason: PreviewGatewayUnavailableError["reason"]) =>
    new PreviewGatewayUnavailableError({ port, reason });

  const ensureListening = Effect.fn("PreviewGateway.ensureListening")(function* (
    port: number,
    secret: Uint8Array,
  ) {
    if (listeners.has(port)) return;
    const addresses = tailscaleAddresses();
    if (addresses.length === 0) return yield* unavailable(port, "no-tailscale-address");
    const handlers: GatewayHandlers = { port, secret, onUpstreamGone: () => closePort(port) };
    const bound: NodeHttp.Server[] = [];
    for (const address of addresses) {
      const server = NodeHttp.createServer(handleGatewayRequest(handlers));
      server.on("upgrade", handleGatewayUpgrade(handlers));
      server.on("clientError", (_error, socket) => socket.destroy());
      const result = yield* Effect.result(listen(server, port, address));
      if (result._tag === "Success") bound.push(server);
      else yield* Effect.logDebug("preview gateway could not bind", { port, address });
    }
    // Usually a dev server already bound to all interfaces, which is directly
    // reachable, or something else (such as `tailscale serve`) owning the port.
    if (bound.length === 0) return yield* unavailable(port, "port-in-use");
    listeners.set(port, bound);
  });

  const open: PreviewGateway["Service"]["open"] = Effect.fn("PreviewGateway.open")(
    function* (port) {
      const servers = yield* portDiscovery.scan();
      if (!servers.some((server) => server.port === port)) {
        return yield* unavailable(port, "not-discovered");
      }
      const secret = yield* secretStore
        .getOrCreateRandom(SIGNING_SECRET_NAME, 32)
        .pipe(Effect.mapError(() => unavailable(port, "unexpected")));
      yield* openLock.withPermits(1)(ensureListening(port, secret));
      const now = yield* Clock.currentTimeMillis;
      return { token: signGatewayToken({ port, expiresAt: now + URL_TOKEN_TTL_MS }, secret) };
    },
  );

  return PreviewGateway.of({ open });
});

export const layer = Layer.effect(PreviewGateway, make);
