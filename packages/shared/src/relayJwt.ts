import * as Effect from "effect/Effect";
import * as JoseError from "effect/jose/JoseError";
import * as Jwt from "effect/jose/Jwt";
import * as Schema from "effect/Schema";

export class RelayJwtError extends Schema.TaggedError<RelayJwtError>()("RelayJwtError", {
  operation: Schema.Literals(["sign", "verify", "decode"]),
  typ: Schema.optional(Schema.String),
  issuer: Schema.optional(Schema.String),
  audience: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.typ === undefined
      ? `Failed to ${this.operation} relay JWT.`
      : `Failed to ${this.operation} relay JWT of type "${this.typ}".`;
  }

  static diagnosticCode(error: RelayJwtError): string {
    if (JoseError.isJoseError(error.cause)) {
      const reason = error.cause.reason;
      return reason._tag === "ClaimValidationFailed"
        ? `${reason._tag}.${reason.claim}.${reason.reason}`
        : reason._tag;
    }
    return Schema.isSchemaError(error.cause) ? "SchemaError" : "unknown";
  }
}

export type RelayJwtClaims = Readonly<Record<string, Schema.Json>>;

/** Reads claims without verifying them. Never authorize on the result. */
export const decodeRelayJwt = Effect.fn("relayJwt.decode")(function* (
  token: string,
): Effect.fn.Return<RelayJwtClaims, RelayJwtError> {
  const unverified = yield* Jwt.decodeUnverified(token).pipe(
    Effect.mapError((cause) => new RelayJwtError({ operation: "decode", cause })),
  );
  return unverified.claims;
});
