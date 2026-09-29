// @effect-diagnostics nodeBuiltinImport:off - exercises the gateway over real sockets
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalFetch:off
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import { PREVIEW_GATEWAY_TOKEN_QUERY_PARAM } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  gatewayCookieName,
  handleGatewayRequest,
  handleGatewayUpgrade,
  rewriteLocation,
  splitGatewayHost,
  signGatewayToken,
  stripT3Cookies,
  tailscaleAddresses,
} from "./Gateway.ts";

const secret = new Uint8Array(32).fill(7);
const servers: NodeHttp.Server[] = [];

const listen = async (server: NodeHttp.Server): Promise<number> => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as NodeNet.AddressInfo).port;
};

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface Seen {
  host?: string | undefined;
  cookie?: string | undefined;
}

const startUpstream = async (seen: Seen) => {
  const upstream = NodeHttp.createServer((request, response) => {
    seen.host = request.headers.host;
    seen.cookie = request.headers.cookie;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `http://localhost:${upstreamPort}/login` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<p>${request.url}</p>`);
  });
  upstream.on("upgrade", (_request, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    socket.on("data", (chunk) => socket.write(chunk));
    socket.on("end", () => socket.destroy());
  });
  const upstreamPort = await listen(upstream);
  return upstreamPort;
};

const startGateway = async (upstreamPort: number, onUpstreamGone = () => {}) => {
  const handlers = { port: upstreamPort, secret, machineName: "xps", onUpstreamGone };
  const gateway = NodeHttp.createServer(handleGatewayRequest(handlers));
  gateway.on("upgrade", handleGatewayUpgrade(handlers));
  return `http://127.0.0.1:${await listen(gateway)}`;
};

const cookieFor = (port: number) =>
  `${gatewayCookieName(port)}=${signGatewayToken({ port, expiresAt: Date.now() + 60_000 }, secret)}`;

describe("preview gateway", () => {
  it("rejects requests without a gateway cookie", async () => {
    const seen: Seen = {};
    const origin = await startGateway(await startUpstream(seen));

    const response = await fetch(`${origin}/`);

    expect(response.status).toBe(401);
    expect(seen.host).toBeUndefined();
  });

  it("trades a URL token for a cookie and redirects without it", async () => {
    const upstreamPort = await startUpstream({});
    const origin = await startGateway(upstreamPort);
    const token = signGatewayToken({ port: upstreamPort, expiresAt: Date.now() + 60_000 }, secret);

    const response = await fetch(
      `${origin}/pos?tenant=a&${PREVIEW_GATEWAY_TOKEN_QUERY_PARAM}=${token}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/pos?tenant=a");
    expect(response.headers.get("set-cookie")).toContain(`${gatewayCookieName(upstreamPort)}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("strips a stale URL token when the cookie still grants access", async () => {
    const upstreamPort = await startUpstream({});
    const origin = await startGateway(upstreamPort);
    const expired = signGatewayToken({ port: upstreamPort, expiresAt: Date.now() - 1 }, secret);

    const response = await fetch(`${origin}/a?${PREVIEW_GATEWAY_TOKEN_QUERY_PARAM}=${expired}`, {
      headers: { cookie: cookieFor(upstreamPort) },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/a");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects tokens minted for another port or already expired", async () => {
    const upstreamPort = await startUpstream({});
    const origin = await startGateway(upstreamPort);
    const otherPort = signGatewayToken(
      { port: upstreamPort + 1, expiresAt: Date.now() + 60_000 },
      secret,
    );
    const expired = signGatewayToken({ port: upstreamPort, expiresAt: Date.now() - 1 }, secret);

    for (const token of [otherPort, expired]) {
      const response = await fetch(`${origin}/?${PREVIEW_GATEWAY_TOKEN_QUERY_PARAM}=${token}`, {
        redirect: "manual",
      });
      expect(response.status).toBe(401);
    }
  });

  it("proxies as the local request and never forwards T3 cookies", async () => {
    const seen: Seen = {};
    const upstreamPort = await startUpstream(seen);
    const origin = await startGateway(upstreamPort);

    const response = await fetch(`${origin}/app?x=1`, {
      headers: { cookie: `${cookieFor(upstreamPort)}; t3_session_3773=secret; app_session=keep` },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>/app?x=1</p>");
    expect(seen.host).toBe(`localhost:${upstreamPort}`);
    expect(seen.cookie).toBe("app_session=keep");
  });

  it("rewrites upstream redirects back to the gateway origin", async () => {
    const upstreamPort = await startUpstream({});
    const origin = await startGateway(upstreamPort);

    const response = await fetch(`${origin}/redirect`, {
      headers: { cookie: cookieFor(upstreamPort) },
      redirect: "manual",
    });

    // In production the gateway listens on the upstream's port number.
    expect(response.headers.get("location")).toBe(`http://127.0.0.1:${upstreamPort}/login`);
  });

  it("forwards a tenant subdomain of the machine name as a localhost subdomain", async () => {
    const seen: Seen = {};
    const upstreamPort = await startUpstream(seen);
    const origin = new URL(await startGateway(upstreamPort));

    const status = await new Promise<number | undefined>((resolve, reject) => {
      NodeHttp.get(
        {
          host: origin.hostname,
          port: origin.port,
          path: "/dashboard",
          headers: { host: `ember-oak.xps:${upstreamPort}`, cookie: cookieFor(upstreamPort) },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).on("error", reject);
    });

    expect(status).toBe(200);
    expect(seen.host).toBe(`ember-oak.localhost:${upstreamPort}`);
  });

  it("relays authorized WebSocket upgrades", async () => {
    const upstreamPort = await startUpstream({});
    const origin = new URL(await startGateway(upstreamPort));

    const reply = await new Promise<string>((resolve, reject) => {
      const socket = NodeNet.connect(Number(origin.port), origin.hostname, () => {
        socket.write(
          `GET /hmr HTTP/1.1\r\nHost: ${origin.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: ${cookieFor(upstreamPort)}\r\n\r\n`,
        );
      });
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString();
        if (received.includes("\r\n\r\n") && !received.includes("ping")) socket.write("ping");
        if (received.endsWith("ping")) {
          socket.destroy();
          resolve(received);
        }
      });
      socket.on("error", reject);
    });

    expect(reply.startsWith("HTTP/1.1 101")).toBe(true);
    expect(reply.endsWith("ping")).toBe(true);
  });

  it("reports a refused upstream so the port can be released", async () => {
    const closed = NodeHttp.createServer();
    const port = await listen(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    let gone = false;
    const origin = await startGateway(port, () => {
      gone = true;
    });

    const response = await fetch(`${origin}/`, { headers: { cookie: cookieFor(port) } });

    expect(response.status).toBe(502);
    expect(gone).toBe(true);
  });
});

describe("preview gateway helpers", () => {
  it("keeps only non-T3 cookies", () => {
    expect(stripT3Cookies("t3_session=a; theme=dark; t3_preview_gateway_1=b")).toBe("theme=dark");
    expect(stripT3Cookies("t3_session=a")).toBeUndefined();
  });

  it("leaves redirects to other origins alone", () => {
    expect(rewriteLocation("https://example.com/x", 8971, "xps:8971", "xps")).toBe(
      "https://example.com/x",
    );
    expect(rewriteLocation("http://127.0.0.1:8971/a?b#c", 8971, "xps:8971", "xps")).toBe(
      "http://xps:8971/a?b#c",
    );
  });

  it("maps tenant redirects onto the machine name", () => {
    expect(
      rewriteLocation("http://demo.localhost:8971/order-ahead/", 8971, "ember-oak.xps:8971", "xps"),
    ).toBe("http://demo.xps:8971/order-ahead/");
    expect(rewriteLocation("http://demo.localhost:8971/", 8971, "100.99.182.95:8971", "xps")).toBe(
      "http://100.99.182.95:8971/",
    );
  });

  it("splits hosts around the machine name", () => {
    expect(splitGatewayHost("ember-oak.xps:8971", "xps")).toEqual({
      subdomain: "ember-oak",
      base: "xps",
    });
    expect(splitGatewayHost("a.b.xps.tail1ab873.ts.net:1", "xps")).toEqual({
      subdomain: "a.b",
      base: "xps.tail1ab873.ts.net",
    });
    expect(splitGatewayHost("xps:8971", "xps")).toEqual({ subdomain: null, base: "xps" });
    expect(splitGatewayHost("100.99.182.95:8971", "xps")).toEqual({
      subdomain: null,
      base: "100.99.182.95",
    });
  });

  it("binds only Tailscale addresses", () => {
    const entry = (address: string) =>
      ({ address, netmask: "", family: "IPv4", mac: "", internal: false, cidr: null }) as const;
    expect(
      tailscaleAddresses({
        lo: [entry("127.0.0.1")],
        eth0: [entry("192.168.18.142")],
        tailscale0: [entry("100.99.182.95"), entry("fd7a:115c:a1e0::1f35:b660")],
      }),
    ).toEqual(["100.99.182.95", "fd7a:115c:a1e0::1f35:b660"]);
  });
});
