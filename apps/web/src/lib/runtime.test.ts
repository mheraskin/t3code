import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
// Load the runtime's module graph once at collection, outside the per-test timeout;
// each case re-evaluates it from that cache after vi.resetModules().
import "./runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web runtime without T3 Connect", () => {
  it("never calls the relay, even when a relay URL is configured", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    const { runtime: freshRuntime } = await import("./runtime");

    try {
      const result = await freshRuntime.runPromise(
        ManagedRelay.ManagedRelayClient.pipe(
          Effect.flatMap((relay) => relay.listEnvironments({ clerkToken: "token" })),
          Effect.result,
        ),
      );
      expect(result._tag).toBe("Failure");
    } finally {
      await freshRuntime.dispose();
    }

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
