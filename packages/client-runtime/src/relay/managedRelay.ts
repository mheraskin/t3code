import {
  type RelayClientEnvironmentRecord,
  type RelayClientDeviceRecord,
  type RelayDeviceRegistrationRequest,
  RelayDpopAccessTokenScope,
  type RelayEnvironmentConnectResponse,
  type RelayEnvironmentLinkChallengeRequest,
  type RelayEnvironmentLinkChallengeResponse,
  type RelayEnvironmentLinkRequest,
  type RelayEnvironmentLinkResponse,
  type RelayEnvironmentStatusResponse,
  type RelayAgentActivitySnapshotResponse,
  type RelayLiveActivityRegistrationRequest,
  type RelayOkResponse,
  type RelayPublicClientId,
  type RelayT3ChatLinkRequestResponse,
  type RelayT3ChatLinkResponse,
  RelayProtectedError,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as HttpMethod from "effect/http/HttpMethod";
import { msg } from "gt-i18n";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";
import { type MarkedText, markedTextEnglish } from "../errors/translatable.ts";
import { relayRequestFailureText } from "./errorPresentation.ts";

export interface ManagedRelayDpopProofInput {
  readonly method: HttpMethod.HttpMethod;
  readonly url: string;
  readonly accessToken?: string;
}

export class ManagedRelayDpopKeyLoadError extends Schema.TaggedError<ManagedRelayDpopKeyLoadError>()(
  "ManagedRelayDpopKeyLoadError",
  {
    keyStore: Schema.Literals(["expo-secure-store", "indexed-db"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [msg("Could not load relay DPoP proof key.")];
  }
}

export class ManagedRelayDpopProofCreationError extends Schema.TaggedError<ManagedRelayDpopProofCreationError>()(
  "ManagedRelayDpopProofCreationError",
  {
    method: Schema.String,
    url: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not create the relay DPoP proof for ${this.method} ${this.url}.`;
  }
}

export const ManagedRelayDpopSignerError = Schema.Union([
  ManagedRelayDpopKeyLoadError,
  ManagedRelayDpopProofCreationError,
]);
export type ManagedRelayDpopSignerError = typeof ManagedRelayDpopSignerError.Type;

export const ManagedRelayRequestAction = Schema.Literals([
  "exchange relay DPoP access token",
  "list relay-managed environments",
  "list relay client devices",
  "create relay environment link challenge",
  "link relay environment",
  "unlink relay environment",
  "get relay environment status",
  "connect relay environment",
  "register relay mobile device",
  "unregister relay mobile device",
  "register relay live activity",
  "read relay agent activity snapshot",
  "read linked T3 Chat account",
  "start T3 Chat linking",
  "unlink T3 Chat account",
]);
export type ManagedRelayRequestAction = typeof ManagedRelayRequestAction.Type;

export const ManagedRelayRequestActivity = Schema.Literals([
  "Relay DPoP access token exchange",
  "Relay environment listing",
  "Relay client device listing",
  "Relay environment link challenge",
  "Relay environment linking",
  "Relay environment unlinking",
  "Relay environment status request",
  "Relay environment connection",
  "Relay mobile device registration",
  "Relay mobile device unregistration",
  "Relay Live Activity registration",
  "Relay agent activity snapshot",
  "Relay T3 Chat link lookup",
  "Relay T3 Chat link request",
  "Relay T3 Chat unlinking",
]);
export type ManagedRelayRequestActivity = typeof ManagedRelayRequestActivity.Type;

const REQUEST_TIMED_OUT_TEXT: Record<ManagedRelayRequestActivity, string> = {
  "Relay DPoP access token exchange": msg("Relay DPoP access token exchange timed out."),
  "Relay environment listing": msg("Relay environment listing timed out."),
  "Relay client device listing": msg("Relay client device listing timed out."),
  "Relay environment link challenge": msg("Relay environment link challenge timed out."),
  "Relay environment linking": msg("Relay environment linking timed out."),
  "Relay environment unlinking": msg("Relay environment unlinking timed out."),
  "Relay environment status request": msg("Relay environment status request timed out."),
  "Relay environment connection": msg("Relay environment connection timed out."),
  "Relay mobile device registration": msg("Relay mobile device registration timed out."),
  "Relay mobile device unregistration": msg("Relay mobile device unregistration timed out."),
  "Relay Live Activity registration": msg("Relay Live Activity registration timed out."),
  "Relay agent activity snapshot": msg("Relay agent activity snapshot timed out."),
  "Relay T3 Chat link lookup": msg("Relay T3 Chat link lookup timed out."),
  "Relay T3 Chat link request": msg("Relay T3 Chat link request timed out."),
  "Relay T3 Chat unlinking": msg("Relay T3 Chat unlinking timed out."),
};

export class ManagedRelayRequestTimeoutError extends Schema.TaggedError<ManagedRelayRequestTimeoutError>()(
  "ManagedRelayRequestTimeoutError",
  {
    activity: ManagedRelayRequestActivity,
    timeoutMs: Schema.Number,
    traceId: Schema.NullOr(Schema.String),
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [REQUEST_TIMED_OUT_TEXT[this.activity], NETWORK_BLOCKING_HINT];
  }
}

export class ManagedRelayUrlInvalidError extends Schema.TaggedError<ManagedRelayUrlInvalidError>()(
  "ManagedRelayUrlInvalidError",
  {
    relayUrl: Schema.String,
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [msg("Relay URL must be a secure absolute HTTPS origin.")];
  }
}

const REQUEST_FAILED_TEXT: Record<
  ManagedRelayRequestAction,
  { readonly failed: string; readonly failedWithDetail: string }
> = {
  "exchange relay DPoP access token": {
    failed: msg("Could not exchange relay DPoP access token."),
    failedWithDetail: msg("Could not exchange relay DPoP access token:"),
  },
  "list relay-managed environments": {
    failed: msg("Could not list relay-managed environments."),
    failedWithDetail: msg("Could not list relay-managed environments:"),
  },
  "list relay client devices": {
    failed: msg("Could not list relay client devices."),
    failedWithDetail: msg("Could not list relay client devices:"),
  },
  "create relay environment link challenge": {
    failed: msg("Could not create relay environment link challenge."),
    failedWithDetail: msg("Could not create relay environment link challenge:"),
  },
  "link relay environment": {
    failed: msg("Could not link relay environment."),
    failedWithDetail: msg("Could not link relay environment:"),
  },
  "unlink relay environment": {
    failed: msg("Could not unlink relay environment."),
    failedWithDetail: msg("Could not unlink relay environment:"),
  },
  "get relay environment status": {
    failed: msg("Could not get relay environment status."),
    failedWithDetail: msg("Could not get relay environment status:"),
  },
  "connect relay environment": {
    failed: msg("Could not connect relay environment."),
    failedWithDetail: msg("Could not connect relay environment:"),
  },
  "register relay mobile device": {
    failed: msg("Could not register relay mobile device."),
    failedWithDetail: msg("Could not register relay mobile device:"),
  },
  "unregister relay mobile device": {
    failed: msg("Could not unregister relay mobile device."),
    failedWithDetail: msg("Could not unregister relay mobile device:"),
  },
  "register relay live activity": {
    failed: msg("Could not register relay live activity."),
    failedWithDetail: msg("Could not register relay live activity:"),
  },
  "read relay agent activity snapshot": {
    failed: msg("Could not read relay agent activity snapshot."),
    failedWithDetail: msg("Could not read relay agent activity snapshot:"),
  },
  "read linked T3 Chat account": {
    failed: msg("Could not read linked T3 Chat account."),
    failedWithDetail: msg("Could not read linked T3 Chat account:"),
  },
  "start T3 Chat linking": {
    failed: msg("Could not start T3 Chat linking."),
    failedWithDetail: msg("Could not start T3 Chat linking:"),
  },
  "unlink T3 Chat account": {
    failed: msg("Could not unlink T3 Chat account."),
    failedWithDetail: msg("Could not unlink T3 Chat account:"),
  },
};

export class ManagedRelayRequestFailedError extends Schema.TaggedError<ManagedRelayRequestFailedError>()(
  "ManagedRelayRequestFailedError",
  {
    action: ManagedRelayRequestAction,
    transportFailed: Schema.optionalKey(Schema.Boolean),
    cause: Schema.Defect(),
    relayError: Schema.optional(RelayProtectedError),
    status: Schema.optional(Schema.Number),
    traceId: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    const text = REQUEST_FAILED_TEXT[this.action];
    if (this.transportFailed) return [text.failed, NETWORK_BLOCKING_HINT];
    const detail = relayRequestFailureText(this);
    return detail ? [text.failedWithDetail, ...detail] : [text.failed];
  }
}

export class ManagedRelayAccessTokenScopesUnexpectedError extends Schema.TaggedError<ManagedRelayAccessTokenScopesUnexpectedError>()(
  "ManagedRelayAccessTokenScopesUnexpectedError",
  {
    requestedScopes: Schema.Array(RelayDpopAccessTokenScope),
    grantedScope: Schema.String,
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [msg("Relay granted unexpected DPoP access token scopes.")];
  }
}

export class ManagedRelayTokenProofCreationError extends Schema.TaggedError<ManagedRelayTokenProofCreationError>()(
  "ManagedRelayTokenProofCreationError",
  {
    method: Schema.String,
    url: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [msg("Could not create relay token DPoP proof.")];
  }
}

export class ManagedRelayRequestProofCreationError extends Schema.TaggedError<ManagedRelayRequestProofCreationError>()(
  "ManagedRelayRequestProofCreationError",
  {
    method: Schema.String,
    url: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return markedTextEnglish(this.i18nMessage);
  }

  get i18nMessage(): MarkedText {
    return [msg("Could not create relay request DPoP proof.")];
  }
}

export const ManagedRelayClientError = Schema.Union([
  ManagedRelayUrlInvalidError,
  ManagedRelayRequestFailedError,
  ManagedRelayRequestTimeoutError,
  ManagedRelayAccessTokenScopesUnexpectedError,
  ManagedRelayDpopKeyLoadError,
  ManagedRelayTokenProofCreationError,
  ManagedRelayRequestProofCreationError,
]);
export type ManagedRelayClientError = typeof ManagedRelayClientError.Type;

export class ManagedRelayDpopSigner extends Context.Service<
  ManagedRelayDpopSigner,
  {
    readonly thumbprint: Effect.Effect<string, ManagedRelayDpopKeyLoadError>;
    readonly createProof: (
      input: ManagedRelayDpopProofInput,
    ) => Effect.Effect<string, ManagedRelayDpopProofCreationError>;
  }
>()("@t3tools/client-runtime/relay/managedRelay/ManagedRelayDpopSigner") {}

export const MANAGED_RELAY_REQUEST_TIMEOUT_MS = 10_000;

export interface ManagedRelayAccessTokenCacheEntry {
  readonly accountId: string;
  readonly clientId: RelayPublicClientId;
  readonly relayUrl: string;
  readonly thumbprint: string;
  readonly scopes: ReadonlyArray<RelayDpopAccessTokenScope>;
  readonly accessToken: string;
  readonly expiresAtMillis: number;
}

export interface ManagedRelayAccessTokenStore {
  readonly load: Effect.Effect<ReadonlyArray<ManagedRelayAccessTokenCacheEntry>>;
  readonly save: (entries: ReadonlyArray<ManagedRelayAccessTokenCacheEntry>) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

export interface ManagedRelayAuthorization {
  readonly accessToken: string;
  readonly proof: string;
  readonly thumbprint: string;
}

export interface ManagedRelayClientLayerOptions {
  readonly relayUrl: string;
  readonly clientId: RelayPublicClientId;
  readonly accessTokenStore?: ManagedRelayAccessTokenStore;
}

export class ManagedRelayClient extends Context.Service<
  ManagedRelayClient,
  {
    readonly relayUrl: string;
    readonly listEnvironments: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<ReadonlyArray<RelayClientEnvironmentRecord>, ManagedRelayClientError>;
    readonly listDevices: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<ReadonlyArray<RelayClientDeviceRecord>, ManagedRelayClientError>;
    readonly createEnvironmentLinkChallenge: (input: {
      readonly clerkToken: string;
      readonly payload: RelayEnvironmentLinkChallengeRequest;
    }) => Effect.Effect<RelayEnvironmentLinkChallengeResponse, ManagedRelayClientError>;
    readonly linkEnvironment: (input: {
      readonly clerkToken: string;
      readonly payload: RelayEnvironmentLinkRequest;
    }) => Effect.Effect<RelayEnvironmentLinkResponse, ManagedRelayClientError>;
    readonly unlinkEnvironment: (input: {
      readonly clerkToken: string;
      readonly environmentId: RelayClientEnvironmentRecord["environmentId"];
    }) => Effect.Effect<RelayOkResponse, ManagedRelayClientError>;
    readonly getT3ChatLink: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<RelayT3ChatLinkResponse, ManagedRelayClientError>;
    readonly createT3ChatLinkRequest: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<RelayT3ChatLinkRequestResponse, ManagedRelayClientError>;
    readonly unlinkT3Chat: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<RelayOkResponse, ManagedRelayClientError>;
    readonly getEnvironmentStatus: (input: {
      readonly clerkToken: string;
      readonly scopes: ReadonlyArray<RelayDpopAccessTokenScope>;
      readonly environmentId: RelayClientEnvironmentRecord["environmentId"];
    }) => Effect.Effect<RelayEnvironmentStatusResponse, ManagedRelayClientError>;
    readonly connectEnvironment: (input: {
      readonly clerkToken: string;
      readonly scopes: ReadonlyArray<RelayDpopAccessTokenScope>;
      readonly environmentId: RelayClientEnvironmentRecord["environmentId"];
      readonly deviceId?: string;
    }) => Effect.Effect<RelayEnvironmentConnectResponse, ManagedRelayClientError>;
    readonly registerDevice: (input: {
      readonly clerkToken: string;
      readonly payload: RelayDeviceRegistrationRequest;
    }) => Effect.Effect<RelayOkResponse, ManagedRelayClientError>;
    readonly unregisterDevice: (input: {
      readonly clerkToken: string;
      readonly deviceId: string;
    }) => Effect.Effect<RelayOkResponse, ManagedRelayClientError>;
    readonly registerLiveActivity: (input: {
      readonly clerkToken: string;
      readonly payload: RelayLiveActivityRegistrationRequest;
    }) => Effect.Effect<RelayOkResponse, ManagedRelayClientError>;
    readonly getAgentActivitySnapshot: (input: {
      readonly clerkToken: string;
    }) => Effect.Effect<RelayAgentActivitySnapshotResponse, ManagedRelayClientError>;
    readonly resetTokenCache: Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/relay/managedRelay/ManagedRelayClient") {}

function disabledManagedRelayClient(relayUrl: string): ManagedRelayClient["Service"] {
  const unavailable = (spanName: string) =>
    Effect.fn(spanName)(function* () {
      return yield* new ManagedRelayUrlInvalidError({ relayUrl });
    });
  return ManagedRelayClient.of({
    relayUrl,
    listEnvironments: unavailable("clientRuntime.managedRelay.listEnvironments"),
    listDevices: unavailable("clientRuntime.managedRelay.listDevices"),
    createEnvironmentLinkChallenge: unavailable(
      "clientRuntime.managedRelay.createEnvironmentLinkChallenge",
    ),
    linkEnvironment: unavailable("clientRuntime.managedRelay.linkEnvironment"),
    unlinkEnvironment: unavailable("clientRuntime.managedRelay.unlinkEnvironment"),
    getT3ChatLink: unavailable("clientRuntime.managedRelay.getT3ChatLink"),
    createT3ChatLinkRequest: unavailable("clientRuntime.managedRelay.createT3ChatLinkRequest"),
    unlinkT3Chat: unavailable("clientRuntime.managedRelay.unlinkT3Chat"),
    getEnvironmentStatus: unavailable("clientRuntime.managedRelay.getEnvironmentStatus"),
    connectEnvironment: unavailable("clientRuntime.managedRelay.connectEnvironment"),
    registerDevice: unavailable("clientRuntime.managedRelay.registerDevice"),
    unregisterDevice: unavailable("clientRuntime.managedRelay.unregisterDevice"),
    registerLiveActivity: unavailable("clientRuntime.managedRelay.registerLiveActivity"),
    getAgentActivitySnapshot: unavailable("clientRuntime.managedRelay.getAgentActivitySnapshot"),
    resetTokenCache: Effect.void.pipe(
      Effect.withSpan("clientRuntime.managedRelay.resetTokenCache"),
    ),
  });
}

/** T3 Connect is removed from this build, so the client never calls a relay URL. */
const make = (options: ManagedRelayClientLayerOptions) =>
  Effect.succeed(disabledManagedRelayClient(options.relayUrl));

export const layer = (options: ManagedRelayClientLayerOptions) =>
  Layer.effect(ManagedRelayClient, make(options));
