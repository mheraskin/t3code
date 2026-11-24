// Privacy fork: analytics are permanently off. Nothing is buffered, nothing is
// sent, and no identity is read. There is no env var, setting or policy that
// turns it back on; the service only exists so callers keep compiling.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Always false: telemetry is disabled in this fork. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<boolean>;

    readonly flush: Effect.Effect<void>;

    /** No-op: owner identities are never recorded. */
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

/** @public */
export const make = Effect.succeed(
  AnalyticsService.of({
    record: Effect.fn("AnalyticsService.record")(function* () {
      return false;
    }),
    flush: Effect.void,
    recordOwners: Effect.fn("AnalyticsService.recordOwners")(function* () {}),
  }),
);

export const layer = Layer.effect(AnalyticsService, make);
