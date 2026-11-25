import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { forgetConnectLink } from "./connectRemoved.ts";

const layer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-connect-removed-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(layer)("forgetConnectLink", (it) => {
  it.effect("deletes an older build's link so nothing can reach the relay again", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const encode = (value: string) => new TextEncoder().encode(value);
      const linked = [
        "cloud-relay-url",
        "cloud-relay-environment-credential",
        "cloud-publish-agent-activity",
        "cloud-endpoint-runtime-config",
        "cloud-cli-desired-link",
        "cloud-cli-oauth-token",
      ];
      for (const name of linked) yield* secrets.set(name, encode("value"));
      yield* secrets.set("unrelated-secret", encode("kept"));

      yield* forgetConnectLink(stateDir);

      for (const name of linked) {
        assert.isTrue(Option.isNone(yield* secrets.get(name)), name);
      }
      assert.isTrue(Option.isSome(yield* secrets.get("unrelated-secret")));
      // A second start finds nothing to delete.
      yield* forgetConnectLink(stateDir);
    }),
  );
});
