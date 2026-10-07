import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const readPreparedConnection = vi.fn();

vi.mock("~/state/session", () => ({ readPreparedConnection }));

const environmentId = EnvironmentId.make("environment-1");

describe("preview gateway resolution", () => {
  beforeEach(() => readPreparedConnection.mockReset());

  it("routes loopback URLs on a tailnet environment through the gateway", async () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://100.99.182.95:3773" });
    const { resolvePreviewGatewayUrl } = await import("./previewGateway");
    const openGateway = vi.fn(async () => AsyncResult.success({ token: "tok", hostname: "xps" }));

    const url = await resolvePreviewGatewayUrl(
      environmentId,
      "localhost:8971/pos?tenant=a#top",
      openGateway,
    );

    expect(openGateway).toHaveBeenCalledWith({ environmentId, input: { port: 8971 } });
    expect(url).toBe("http://xps:8971/pos?tenant=a&t3PreviewGatewayToken=tok#top");
  });

  it("keeps tenant subdomains on the machine name", async () => {
    const { previewGatewayTarget, previewGatewayUrl } = await import("./previewGateway");
    const env = "http://100.99.182.95:3773";
    const fromLocalhost = previewGatewayTarget(env, "http://ember-oak.localhost:8971/dashboard");
    const fromMachine = previewGatewayTarget(env, "http://ember-oak.xps:8971/dashboard", "xps");
    for (const target of [fromLocalhost, fromMachine]) {
      expect(target && previewGatewayUrl(target, "tok", "xps")).toBe(
        "http://ember-oak.xps:8971/dashboard?t3PreviewGatewayToken=tok",
      );
    }
    // Without a machine name the IP is used and the subdomain cannot be kept.
    expect(fromLocalhost && previewGatewayUrl(fromLocalhost, "tok")).toBe(
      "http://100.99.182.95:8971/dashboard?t3PreviewGatewayToken=tok",
    );
  });

  it("keeps MagicDNS environment hosts", async () => {
    const { previewGatewayTarget, previewGatewayUrl } = await import("./previewGateway");
    const target = previewGatewayTarget(
      "http://xps.tail1ab873.ts.net:3773",
      "http://127.0.0.1:5173/",
    );
    expect(target && previewGatewayUrl(target, "t")).toBe(
      "http://xps.tail1ab873.ts.net:5173/?t3PreviewGatewayToken=t",
    );
  });

  it("does not apply off the tailnet, to non-loopback targets, or to HTTPS", async () => {
    const { previewGatewayTarget } = await import("./previewGateway");
    expect(previewGatewayTarget("http://192.168.1.25:3773", "http://localhost:5173/")).toBeNull();
    expect(previewGatewayTarget("http://localhost:3773", "http://localhost:5173/")).toBeNull();
    expect(previewGatewayTarget("http://100.99.182.95:3773", "https://example.com/")).toBeNull();
    expect(previewGatewayTarget("http://100.99.182.95:3773", "http://example.com/")).toBeNull();
    expect(
      previewGatewayTarget("http://100.99.182.95:3773", "http://other.ts.net/", "xps"),
    ).toBeNull();
    expect(previewGatewayTarget("http://100.99.182.95:3773", "https://localhost:5173/")).toBeNull();
  });

  it("falls back when the gateway is unavailable", async () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://100.99.182.95:3773" });
    const { resolvePreviewGatewayUrl } = await import("./previewGateway");
    const openGateway = vi.fn(async () =>
      AsyncResult.failure<{ readonly token: string }, string>(Cause.fail("port-in-use")),
    );

    expect(
      await resolvePreviewGatewayUrl(environmentId, "http://localhost:8971/", openGateway),
    ).toBeNull();
  });
});
