import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("analytics never queue events or record owners", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    assert.isFalse(yield* analytics.record("server.boot.heartbeat", { threadCount: 3 }));
    yield* analytics.recordOwners([{ source: "claude", ownerId: "a".repeat(64) }], "server");
    yield* analytics.flush;
  }).pipe(Effect.provide(AnalyticsService.layer)),
);
