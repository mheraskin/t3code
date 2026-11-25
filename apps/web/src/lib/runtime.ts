import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import * as PrimaryEnvironmentHttpClient from "../environments/primary/httpClient";
import * as PrimaryEnvironmentHttpLayer from "../environments/primary/httpLayer";

import { DpopProof, ManagedRelay } from "@t3tools/client-runtime/relay";
import { RelayWebClientId } from "@t3tools/contracts/relay";

import * as Dpop from "./dpop";
import * as ClientTracer from "../observability/clientTracer";

// Directly paired addresses still sign with this device's DPoP key.
const layerDpopSigner = DpopProof.layerSigner({
  keyStore: "indexed-db",
  loadOrCreateKey: Dpop.loadOrCreateProofKey(),
});

// Privacy fork: T3 Connect is removed. The connection runtime still asks for a relay client,
// so it gets the disabled one, which fails every call without touching the network.
const layerDisabledRelay = ManagedRelay.layer({
  relayUrl: "http://relay.invalid",
  clientId: RelayWebClientId,
}).pipe(Layer.provideMerge(layerDpopSigner));

const layerHttpClient = layerRemoteHttpClient((input, init) => globalThis.fetch(input, init));

type RuntimeLayerSource =
  | typeof layerHttpClient
  | typeof Dpop.layer
  | typeof Socket.layerWebSocketConstructorGlobal
  | typeof ClientTracer.layer
  | typeof layerDisabledRelay;

const primaryHttpRuntime = ManagedRuntime.make(
  PrimaryEnvironmentHttpClient.layer.pipe(Layer.provide(PrimaryEnvironmentHttpLayer.layer)),
);

export type PrimaryHttpEffectRunner = <A, E>(
  effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient.PrimaryEnvironmentHttpClient>,
) => Promise<A>;

const livePrimaryHttpRunner: PrimaryHttpEffectRunner = (effect) =>
  primaryHttpRuntime.runPromise(effect);

let primaryHttpRunner = livePrimaryHttpRunner;

export const runPrimaryHttp = <A, E>(
  effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient.PrimaryEnvironmentHttpClient>,
) => primaryHttpRunner(effect);

export function __setPrimaryHttpRunnerForTests(runner?: PrimaryHttpEffectRunner): void {
  primaryHttpRunner = runner ?? livePrimaryHttpRunner;
}

const layerRuntime = Layer.mergeAll(
  layerHttpClient,
  Dpop.layer,
  Socket.layerWebSocketConstructorGlobal,
  ClientTracer.layer,
  layerDisabledRelay.pipe(Layer.provide(Layer.mergeAll(layerHttpClient, Dpop.layer))),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(layerRuntime);

export const layer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
