// @effect-diagnostics nodeBuiltinImport:off - fixtures are prepared with plain Git, outside the driver under test.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import { gitSubcommandIndex, repositoryConfigPolicy } from "./gitRepositoryConfigGuard.ts";
import * as VcsProcess from "./VcsProcess.ts";

const layerTest = Layer.mergeAll(GitVcsDriver.layer, VcsProcess.layer).pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-config-guard-test-" }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A folder someone hands the user: its `.git` names commands for every way Git runs one during a
 * read, and each writes its own marker file.
 */
const makeHostileRepository = () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-rce-poc-")),
  );
  const repo = NodePath.join(root, "repo");
  const upstream = NodePath.join(root, "upstream");
  const markers = NodePath.join(root, "markers");
  NodeFS.mkdirSync(markers);
  NodeFS.mkdirSync(upstream);
  runGit(upstream, ["init", "-q", "-b", "main"]);
  NodeFS.writeFileSync(NodePath.join(upstream, "README.md"), "hello\n");
  runGit(upstream, ["add", "README.md"]);
  runGit(upstream, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  runGit(root, ["clone", "-q", upstream, repo]);
  runGit(upstream, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "next",
    "--allow-empty",
  ]);

  const touch = (name: string) => `touch ${shellQuote(NodePath.join(markers, name))}`;
  const set = (key: string, value: string) => runGit(repo, ["config", key, value]);
  set("core.fsmonitor", `${touch("fsmonitor")}; false`);
  set("diff.external", touch("diff-external"));
  set("diff.evil.textconv", `${touch("textconv")}; cat`);
  set("diff.evil.command", touch("diff-command"));
  set("merge.evil.driver", touch("merge-driver"));
  set("remote.origin.uploadpack", `${touch("uploadpack")}; git-upload-pack`);
  set("core.sshCommand", touch("ssh"));
  set("log.showSignature", "true");
  set("gpg.program", touch("gpg"));
  // The filter hides in a file the config includes.
  NodeFS.writeFileSync(
    NodePath.join(repo, ".git", "evil.config"),
    `[filter "evil"]\n\tclean = ${touch("filter-clean")}; cat\n\tsmudge = ${touch("filter-smudge")}; cat\n`,
  );
  set("include.path", "evil.config");
  for (const hook of ["reference-transaction", "post-index-change", "post-checkout"]) {
    const hookPath = NodePath.join(repo, ".git", "hooks", hook);
    NodeFS.writeFileSync(hookPath, `#!/bin/sh\n${touch(`hook-${hook}`)}\n`);
    NodeFS.chmodSync(hookPath, 0o755);
  }
  NodeFS.writeFileSync(
    NodePath.join(repo, ".gitattributes"),
    "* filter=evil diff=evil merge=evil\n",
  );
  // A file whose stat data no longer matches the index is rehashed through the clean filter.
  NodeFS.writeFileSync(NodePath.join(repo, "README.md"), "hello\n");
  NodeFS.utimesSync(NodePath.join(repo, "README.md"), 1, 4_102_444_800);
  NodeFS.writeFileSync(NodePath.join(repo, "notes.txt"), "untracked\n");
  return {
    repo,
    markers: () => NodeFS.readdirSync(markers).toSorted(),
    cleanup: () => NodeFS.rmSync(root, { recursive: true, force: true }),
  };
};

describe("repository config guard", () => {
  it("finds the subcommand after global options", () => {
    assert.equal(gitSubcommandIndex(["-c", "a=b", "--git-dir", "/x", "status"]), 4);
    assert.equal(gitSubcommandIndex(["-C", "/x", "--no-optional-locks", "diff"]), 3);
    assert.equal(gitSubcommandIndex(["--git-dir=/x", "fetch", "--", "origin"]), 1);
  });

  it("neutralizes drivers only the repository's own config defines", () => {
    const policy = repositoryConfigPolicy(
      [
        "global\0filter.lfs.clean\ngit-lfs clean -- %f",
        "local\0filter.Evil.process\nrun",
        "local\0diff.y.textconv\nrun",
        "local\0core.sshcommand\nrun",
        "",
      ].join("\0"),
    );
    const keys = new Map(policy.overrides);
    assert.equal(keys.get("filter.Evil.process"), "");
    assert.equal(keys.get("diff.y.textconv"), "cat");
    assert.equal(keys.get("core.fsmonitor"), "false");
    assert.isFalse(keys.has("filter.lfs.clean"));
    assert.isTrue(policy.transportConfigured);
  });

  it.effect("project open runs nothing a hostile repository's .git names", () =>
    Effect.acquireUseRelease(
      Effect.sync(makeHostileRepository),
      ({ repo, markers }) =>
        Effect.gen(function* () {
          const driver = yield* GitVcsDriver.GitVcsDriver;
          const vcsProcess = yield* VcsProcess.VcsProcess;

          // What a project's first view reads: status, totals, branches and diffs.
          yield* driver.statusDetailsLocal(repo);
          yield* driver.statusDetailsRemote(repo).pipe(Effect.ignore);
          yield* driver.listRefs({ cwd: repo }).pipe(Effect.ignore);
          for (const args of [
            ["status", "--porcelain=2", "-z"],
            ["diff", "HEAD"],
            ["log", "-p", "-1"],
            ["fetch", "origin"],
          ]) {
            yield* driver
              .execute({ operation: "test.background", cwd: repo, args, allowNonZeroExit: true })
              .pipe(Effect.ignore);
            yield* vcsProcess
              .run({
                operation: "test.background",
                command: "git",
                cwd: repo,
                args,
                allowNonZeroExit: true,
              })
              .pipe(Effect.ignore);
          }

          assert.deepStrictEqual(markers(), []);
        }),
      ({ cleanup }) => Effect.sync(cleanup),
    ).pipe(Effect.provide(layerTest)),
  );

  it.effect("commands the user starts keep the repository's hooks", () =>
    Effect.acquireUseRelease(
      Effect.sync(makeHostileRepository),
      ({ repo, markers }) =>
        Effect.gen(function* () {
          const driver = yield* GitVcsDriver.GitVcsDriver;
          yield* driver.execute({
            operation: "test.userCommit",
            cwd: repo,
            args: [
              "-c",
              "user.name=t",
              "-c",
              "user.email=t@t",
              "commit",
              "-qm",
              "x",
              "--allow-empty",
            ],
            trustRepositoryConfig: true,
          });
          assert.include(markers(), "hook-reference-transaction");
        }),
      ({ cleanup }) => Effect.sync(cleanup),
    ).pipe(Effect.provide(layerTest)),
  );
});
