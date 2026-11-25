import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

/**
 * A project's `.git` config, its includes and its hooks are repository content: Git runs commands
 * they name during plain reads such as `git status`. Background calls neutralize them; commands the
 * user starts (commit, push, pull, checkout) keep them, as Git in a terminal would.
 */

// Command-line config outranks every file, and the environment form also reaches the Git
// processes a command starts, such as `git status` in each submodule.
const ALWAYS: ReadonlyArray<readonly [string, string]> = [
  ["core.fsmonitor", "false"],
  // `.git/hooks` runs without any config, e.g. reference-transaction on a background fetch.
  ["core.hooksPath", "/dev/null"],
  // Submodules have their own config: keep porcelain status and diff out of their worktrees.
  ["diff.ignoreSubmodules", "dirty"],
  ["status.submoduleSummary", "false"],
  ["fetch.recurseSubmodules", "false"],
  ["submodule.recurse", "false"],
  // `gpg.program` cannot be reset to a default from the command line.
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["log.showSignature", "false"],
  // An `ext::` URL, or one `url.*.insteadOf` rewrites to it, runs its command.
  ["protocol.ext.allow", "never"],
];

// These never run a driver or a transport, so they skip reading the repository's config.
const DRIVERLESS_SUBCOMMANDS = new Set([
  "check-attr",
  "check-ignore",
  "commit-tree",
  "config",
  "count-objects",
  "for-each-ref",
  "hook",
  "init",
  "ls-tree",
  "merge-base",
  "mktree",
  "rev-list",
  "rev-parse",
  "show-ref",
  "symbolic-ref",
  "update-ref",
  "var",
  "version",
]);

const needsRepositoryConfig = (args: ReadonlyArray<string>) => {
  const index = gitSubcommandIndex(args);
  if (index === -1) return false;
  const subcommand = args[index]!;
  const rest = args.slice(index + 1);
  if (subcommand === "ls-files") return rest.includes("-m") || rest.includes("--modified");
  if (subcommand === "cat-file")
    return rest.some((arg) => arg === "--textconv" || arg === "--filters");
  if (subcommand === "worktree") return rest[0] !== "list" && rest[0] !== "prune";
  if (subcommand === "remote") return CONNECTING_REMOTE_SUBCOMMANDS.has(rest[0] ?? "");
  return !DRIVERLESS_SUBCOMMANDS.has(subcommand);
};

// Plumbing ignores `diff.ignoreSubmodules`; an explicit later flag from the caller still wins.
const SUBMODULE_WORKTREE_READERS = new Set(["diff-index", "diff-files"]);

// Network commands, which use the keys below that cannot be overridden from the command line
// (`remote.*.uploadpack` takes the first value) or name arbitrary programs.
const TRANSPORT_SUBCOMMANDS = new Set([
  "archive",
  "clone",
  "fetch",
  "fetch-pack",
  "ls-remote",
  "pull",
  "push",
  "send-pack",
  "submodule",
]);

// `git remote` itself only reads config; these subcommands connect.
const CONNECTING_REMOTE_SUBCOMMANDS = new Set(["prune", "set-head", "show", "update"]);

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

export interface RepositoryConfigPolicy {
  readonly overrides: ReadonlyArray<readonly [string, string]>;
  /** The repository's config names transport programs, which only user-started commands may run. */
  readonly transportConfigured: boolean;
  /** Set when the listing was too large to read whole: drivers it hides cannot be neutralized. */
  readonly refuse?: true;
}

/** Without a listing; Git fails the command on the same config problem the listing hit. */
export const STATIC_POLICY: RepositoryConfigPolicy = {
  overrides: ALWAYS,
  transportConfigured: false,
};

const OVERSIZED_CONFIG_POLICY: RepositoryConfigPolicy = {
  overrides: ALWAYS,
  transportConfigured: true,
  refuse: true,
};

/** Index of the Git subcommand in `args`, after global options such as `-c` and `--git-dir`. */
export const gitSubcommandIndex = (args: ReadonlyArray<string>) => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith("-")) return index;
  }
  return -1;
};

/** The same repository selection as `args`, listing config with each value's scope. */
export const configListingArgs = (args: ReadonlyArray<string>) => {
  const subcommand = gitSubcommandIndex(args);
  const globals: string[] = [];
  const end = subcommand === -1 ? args.length : subcommand;
  for (let index = 0; index < end; index++) {
    const arg = args[index]!;
    if (arg === "-c" || arg === "--config-env") {
      index++;
      continue;
    }
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      globals.push(arg, args[index + 1] ?? "");
      index++;
      continue;
    }
    if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=")) globals.push(arg);
  }
  return [...globals, "config", "--list", "--show-scope", "-z"];
};

const UNTRUSTED_SCOPES = new Set(["local", "worktree"]);

const splitKey = (key: string) => {
  const first = key.indexOf(".");
  const last = key.lastIndexOf(".");
  if (first === -1) return null;
  return {
    section: key.slice(0, first).toLowerCase(),
    subsection: first === last ? null : key.slice(first + 1, last),
    variable: key.slice(last + 1).toLowerCase(),
  };
};

const isTransportKey = (section: string, subsection: string | null, variable: string) => {
  switch (section) {
    case "core":
      return (
        subsection === null &&
        (variable === "sshcommand" ||
          variable === "gitproxy" ||
          variable === "askpass" ||
          variable === "alternaterefscommand")
      );
    case "credential":
      return variable === "helper";
    case "remote":
      return (
        subsection !== null &&
        (variable === "uploadpack" || variable === "receivepack" || variable === "vcs")
      );
    default:
      return false;
  }
};

/** Reads `git config --list --show-scope -z` output into the overrides automatic calls need. */
export const repositoryConfigPolicy = (listing: string): RepositoryConfigPolicy => {
  const overrides = new Map<string, string>(ALWAYS);
  let transportConfigured = false;
  const records = listing.split("\0");
  for (let index = 0; index + 1 < records.length; index += 2) {
    const scope = records[index]!;
    if (!UNTRUSTED_SCOPES.has(scope)) continue;
    const record = records[index + 1]!;
    const newline = record.indexOf("\n");
    const parts = splitKey(newline === -1 ? record : record.slice(0, newline));
    if (parts === null) continue;
    const { section, subsection, variable } = parts;
    if (isTransportKey(section, subsection, variable)) transportConfigured = true;
    if (section === "filter" && subsection !== null) {
      overrides.set(`filter.${subsection}.clean`, "");
      overrides.set(`filter.${subsection}.smudge`, "");
      overrides.set(`filter.${subsection}.process`, "");
      overrides.set(`filter.${subsection}.required`, "false");
    } else if (section === "diff" && subsection !== null) {
      // An empty driver command fails the diff; these run nothing from the repository.
      if (variable === "textconv") overrides.set(`diff.${subsection}.textconv`, "cat");
      if (variable === "command") overrides.set(`diff.${subsection}.command`, "true");
    } else if (section === "diff" && variable === "external") {
      overrides.set("diff.external", "true");
    } else if (section === "diff" && variable === "submodule") {
      overrides.set("diff.submodule", "short");
    } else if (section === "merge" && subsection !== null && variable === "driver") {
      overrides.set(`merge.${subsection}.driver`, "true");
    }
  }
  return { overrides: [...overrides], transportConfigured };
};

export type GuardedGitInvocation =
  | {
      readonly _tag: "Run";
      readonly args: ReadonlyArray<string>;
      /** Config to append after the command's own, as `GIT_CONFIG_*` entries. */
      readonly config: ReadonlyArray<readonly [string, string]>;
      readonly env: NodeJS.ProcessEnv;
    }
  | { readonly _tag: "Refused"; readonly detail: string };

export const guardGitInvocation = (input: {
  readonly args: ReadonlyArray<string>;
  readonly policy: RepositoryConfigPolicy;
}): GuardedGitInvocation => {
  const subcommandIndex = gitSubcommandIndex(input.args);
  const subcommand = subcommandIndex === -1 ? undefined : input.args[subcommandIndex];
  if (input.policy.refuse === true && needsRepositoryConfig(input.args)) {
    return {
      _tag: "Refused",
      detail:
        "This repository's Git config is too large for T3 Code to check, so it did not run Git here.",
    };
  }
  const connects =
    subcommand !== undefined &&
    (TRANSPORT_SUBCOMMANDS.has(subcommand) ||
      (subcommand === "remote" &&
        CONNECTING_REMOTE_SUBCOMMANDS.has(input.args[subcommandIndex + 1] ?? "")));
  if (input.policy.transportConfigured && connects) {
    return {
      _tag: "Refused",
      detail:
        "This repository's Git config sets its own transport commands, so T3 Code only runs Git network commands you start.",
    };
  }
  const args =
    subcommand !== undefined && SUBMODULE_WORKTREE_READERS.has(subcommand)
      ? [
          ...input.args.slice(0, subcommandIndex + 1),
          "--ignore-submodules=dirty",
          ...input.args.slice(subcommandIndex + 1),
        ]
      : input.args;
  return {
    _tag: "Run",
    args,
    // `rev-parse --git-path hooks/...` resolves hooks to replicate; it never runs one.
    config:
      subcommand === "rev-parse"
        ? input.policy.overrides.filter(([key]) => key !== "core.hooksPath")
        : input.policy.overrides,
    // A partial clone fetches missing objects on read, through the same transport config.
    env: input.policy.transportConfigured ? { GIT_NO_LAZY_FETCH: "1" } : {},
  };
};

const POLICY_CACHE_CAPACITY = 512;
// Short enough that config a later checkout brings in is seen soon; long enough that status
// polling does not double its Git processes.
const POLICY_CACHE_TTL = Duration.seconds(5);

export const CONFIG_LISTING_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type ConfigListing =
  | { readonly _tag: "Listed"; readonly stdout: string }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Truncated" };

const SELECTOR_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"] as const;

export interface ListingRequest {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  /** Repository selectors the command sets in its environment, which the listing must share. */
  readonly env: NodeJS.ProcessEnv;
}

/** Caches each repository's policy. `readListing` runs `git <args>` in `cwd` with `env` added. */
export const makeRepositoryConfigPolicyCache = Effect.fnUntraced(function* <E>(
  readListing: (request: ListingRequest) => Effect.Effect<ConfigListing, E>,
) {
  const cache = yield* Cache.makeWith(
    (key: string) => {
      const request = JSON.parse(key) as ListingRequest;
      return readListing(request).pipe(
        Effect.map((listing) =>
          listing._tag === "Listed"
            ? repositoryConfigPolicy(listing.stdout)
            : listing._tag === "Truncated"
              ? OVERSIZED_CONFIG_POLICY
              : STATIC_POLICY,
        ),
      );
    },
    {
      capacity: POLICY_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: (policy) => (policy === STATIC_POLICY ? Duration.zero : POLICY_CACHE_TTL),
        onFailure: () => Duration.zero,
      }),
    },
  );
  return {
    get: (cwd: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv | undefined) =>
      needsRepositoryConfig(args)
        ? Cache.get(
            cache,
            JSON.stringify({
              cwd,
              args: configListingArgs(args),
              env: Object.fromEntries(
                SELECTOR_ENV.flatMap((name) =>
                  env?.[name] === undefined ? [] : [[name, env[name]]],
                ),
              ),
            } satisfies ListingRequest),
          )
        : Effect.succeed(STATIC_POLICY),
    invalidateAll: Cache.invalidateAll(cache),
  };
});
