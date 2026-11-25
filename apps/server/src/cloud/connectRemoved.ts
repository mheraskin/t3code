import * as Effect from "effect/Effect";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { reapOrphanRelayClients } from "./RelayClientLedger.ts";

/** Replay markers older T3 Connect builds wrote next to the secrets; pruned like DPoP markers. */
export const CLOUD_REPLAY_MARKER_PREFIXES = [
  "cloud-mint-nonce-",
  "cloud-mint-jti-",
  "cloud-health-nonce-",
  "cloud-health-jti-",
] as const;

/** Link credentials, relay settings, and keys an older build stored when it was linked. */
const CONNECT_SECRETS = [
  "cloud-mint-ed25519-public-key",
  "cloud-endpoint-runtime-config",
  "cloud-endpoint-confirmed-origin",
  "cloud-linked-user-id",
  "cloud-relay-url",
  "cloud-relay-issuer",
  "cloud-relay-environment-credential",
  "cloud-publish-agent-activity",
  "cloud-hold-webhooks-while-offline",
  "cloud-link-revoked",
  "cloud-cli-desired-link",
  "cloud-cli-oauth-token",
  "cloud-link-ed25519-key-pair",
  "cloud-link-ed25519-private-key",
  "cloud-link-ed25519-public-key",
] as const;

/**
 * T3 Connect is removed from this build. An install that was linked before keeps nothing that
 * could reach the relay: its stored link secrets are deleted and any relay client a crashed
 * server left running is stopped. Both steps are local; nothing is sent to the relay.
 */
export const forgetConnectLink = Effect.fn("connectRemoved.forgetConnectLink")(function* (
  stateDir: string,
) {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  yield* Effect.forEach(
    CONNECT_SECRETS,
    (name) =>
      secrets
        .remove(name)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not delete a stored T3 Connect secret", { name, cause }),
          ),
        ),
    { discard: true },
  );
  yield* reapOrphanRelayClients(stateDir);
});
