import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { RelayMobileClientId } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const unavailable = "T3 Connect is not available in this build.";

// T3 Connect is removed: the shared connection runtime still asks for these services, so they
// are present but can never reach the relay or create a DPoP key.
const layerSigner = Layer.succeed(
  ManagedRelay.ManagedRelayDpopSigner,
  ManagedRelay.ManagedRelayDpopSigner.of({
    thumbprint: Effect.fail(
      new ManagedRelay.ManagedRelayDpopKeyLoadError({
        keyStore: "expo-secure-store",
        cause: unavailable,
      }),
    ),
    createProof: Effect.fn("ManagedRelay.ManagedRelayDpopSigner.createProof")(function* (input) {
      return yield* new ManagedRelay.ManagedRelayDpopProofCreationError({
        method: input.method,
        url: input.url,
        cause: unavailable,
      });
    }),
  }),
);

export const layer = ManagedRelay.layer({ relayUrl: "", clientId: RelayMobileClientId }).pipe(
  Layer.provideMerge(layerSigner),
);
