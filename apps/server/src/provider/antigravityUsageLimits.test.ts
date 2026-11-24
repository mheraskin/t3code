import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  antigravityAccountFingerprint,
  antigravitySummaryWindows,
  makeAntigravityUsageProbe,
} from "./antigravityUsageLimits.ts";

describe("Antigravity subscription limits", () => {
  it.effect("reports limits unavailable for every sign-in without reading or requesting", () =>
    Effect.gen(function* () {
      for (const authMethod of ["oauth-personal", "oauth-business", "gemini-api-key"] as const) {
        // The probe needs no FileSystem or HttpClient, so it cannot read tokens or call Google.
        const { probe, clear } = yield* makeAntigravityUsageProbe({
          profileDirectory: "/nonexistent",
          authMethod,
        });
        const limits = yield* probe;
        expect(limits.unavailable?.reason).toBe("unsupported");
        expect(limits.windows).toEqual([]);
        yield* clear;
      }
    }),
  );

  it.effect("parses quota summaries relayed by a CLIProxy hub", () =>
    Effect.gen(function* () {
      const windows = yield* antigravitySummaryWindows(
        {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-weekly",
                  window: "weekly",
                  remainingFraction: 0.75,
                  resetTime: "2026-10-12T19:41:43Z",
                },
              ],
            },
          ],
        },
        Date.parse("2026-10-09T10:16:00Z"),
      );
      expect(windows).toEqual([
        {
          id: "gemini-weekly",
          label: "Gemini · Weekly",
          kind: "weekly",
          usedPercent: 25,
          resetsAt: "2026-10-12T19:41:43.000Z",
          windowDurationMins: 7 * 24 * 60,
        },
      ]);
      expect(yield* antigravityAccountFingerprint({ id: "123" })).toMatch(/^[0-9a-f]{64}$/);
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );
});
