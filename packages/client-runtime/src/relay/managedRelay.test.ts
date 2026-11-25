import { EnvironmentId } from "@t3tools/contracts";
import { RelayEnvironmentConnectScope } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ManagedRelay from "./managedRelay.ts";
import * as RpcHttp from "../rpc/http.ts";

describe("ManagedRelayClient", () => {
  it.effect("never calls the relay, even with a secure relay URL", () => {
    let requestCount = 0;
    const fetchFn = (() => {
      requestCount += 1;
      return Promise.resolve(Response.json({}));
    }) satisfies typeof globalThis.fetch;
    const layer = ManagedRelay.layer({
      relayUrl: "https://relay.example.test",
      clientId: "t3-mobile",
    }).pipe(Layer.provide(RpcHttp.layerRemoteHttpClient(fetchFn)));

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const listed = yield* relayClient
        .listEnvironments({ clerkToken: "clerk-token" })
        .pipe(Effect.flip);
      const connected = yield* relayClient
        .connectEnvironment({
          clerkToken: "clerk-token",
          scopes: [RelayEnvironmentConnectScope],
          environmentId: EnvironmentId.make("environment-1"),
        })
        .pipe(Effect.flip);

      expect(listed._tag).toBe("ManagedRelayUrlInvalidError");
      expect(connected._tag).toBe("ManagedRelayUrlInvalidError");
      expect(requestCount).toBe(0);
    }).pipe(Effect.provide(layer));
  });
});
