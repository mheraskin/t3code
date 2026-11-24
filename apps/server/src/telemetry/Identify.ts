import * as Schema from "effect/Schema";

/**
 * Privacy fork: telemetry identity is gone. The server no longer reads
 * `~/.codex/auth.json`, `~/.claude.json`, the linked T3 Connect account or an
 * anonymous install id to identify the user. Only the owner shape remains so
 * client messages that still carry owners decode; the server drops them.
 */
export const TelemetryOwnerSource = Schema.Literals(["connect", "openai", "claude", "device"]);
export type TelemetryOwnerSource = typeof TelemetryOwnerSource.Type;

export interface TelemetryOwner {
  readonly source: TelemetryOwnerSource;
  readonly ownerId: string;
}
