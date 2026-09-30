# Mocha Dagger Toolchain

Runs [Mocha](https://mochajs.org) tests as Dagger checks, one check per test
file, across every Mocha project in a workspace. Suites and tests show up as
spans in the Dagger trace.

## Requirements

Dagger `v1.0.0-beta.15` or later: the module uses Dagger collections, which
older engines cannot load. Projects need Mocha 9 to 12 in their
`devDependencies` (Mocha 11 and 12 are tested).

## Installation

```console
$ dagger install github.com/dagger/mochajs
```

## Checks

The module has one check, `test`, and it runs per test file. Its address is
`mochajs/projects/tests/test`, and it has two dimensions:

| Flag | Selects |
| --- | --- |
| `--mochajs-project=PATH` | a project, by its root relative to the workspace root (repeatable) |
| `--mochajs-projects` | every project |
| `--mochajs-test-file=PATH` | a test file, by its path relative to the project root (repeatable) |
| `--mochajs-tests` | every test file |
| `--mochajs`, `--by-mochajs` | this module's checks |
| `--check test` | checks named `test`, in every installed module |

```console
$ dagger check -l --all --mochajs                  # one line per project and test file
$ dagger check --mochajs                           # every project, each run whole
$ dagger check --mochajs --mochajs-project=app
$ dagger check --mochajs --mochajs-project=app --mochajs-test-file=test/add.test.js
$ dagger check mochajs/projects/tests/test --mochajs-project=app   # the same, by path
$ dagger list mochajs-projects -a
$ dagger list mochajs-test-files -a --mochajs-project=app
```

`--check test` alone also selects every other installed module's check named
`test`; `--mochajs` narrows it to this one. When another installed module also
has a `MochajsProject` or `MochajsTestFile` type, the flags take a qualified
name; `dagger check --help` lists the flags in effect.

`test` runs once per selected project. With every test file of a project
selected, it runs the project's own `mocha` in the project root, and the
project's Mocha config selects the tests, as `npx mocha` would. With some files
filtered out, it runs only the selected files: the project's config still
applies, minus its `spec`, which Mocha would otherwise add to the files named
on the command line. To load that config, a filtered run uses Mocha's own
loaders from `mocha/lib/cli/options.cjs` (Mocha 12), falling back to
`mocha/lib/cli/options` (Mocha 9–11).

The `test` script in `package.json` is not used: flags it passes to Mocha
(`--exit`, `--require …`) belong in the Mocha config or in the `flags`
setting.

## How a project is run

1. **Install root.** Dependencies are installed at the nearest workspace root
   at or above the project (a `pnpm-workspace.yaml`, or a `package.json` with
   `"workspaces"`), else the nearest directory with a lockfile, else the
   nearest `package.json`. That directory is mounted, without `node_modules`
   and gitignored files, and Mocha runs with the project as its working
   directory, so workspace siblings and shared configs resolve.
2. **Package manager.** The `packageManager` setting, else the install root's
   `package.json` `"packageManager"` field, else its lockfile
   (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`), else npm. pnpm and
   Yarn run through corepack, which is installed when the image lacks it and
   honours the `"packageManager"` version.
3. **Install.** `<package manager> install` plus `installFlags`. Only the
   files an install reads (every `package.json`, lockfiles, `.npmrc`,
   `.yarnrc*`, `.yarn/releases`, `patches`, …, plus the directories that
   `file:`, `link:` and `portal:` dependencies and pnpm's injected workspace
   packages point at) are mounted for it, so editing other source does not
   rerun it. When those directories cannot be worked out (a `package.json`
   that is not valid JSON, or a path outside the install root), the whole
   source is mounted instead. Package manager caches, and pnpm's store (passed
   as `--store-dir`), live on cache volumes.
   Playwright, Puppeteer and Cypress downloads and git hooks are skipped.
4. **Build**, when `build` is set: `<package manager> run build`.
5. **Mocha**: the project's own `node_modules/.bin/mocha`, looked up from the
   project to the install root, with `environment` set and `timeout` applied.
   A project with a `package.json` but no Mocha fails and says so; a project
   with no `package.json` at or above it runs `npx mocha`.

A failure names its project and step, with the end of the output, e.g.
`Mocha failed in app: install failed (npm install, exit 1): …` or
`Mocha failed in app: mocha failed (exit 1): …`. The projects batch lists
every failing project.

## Selecting by directory

Discovery starts from the directory you run Dagger in, so changing directory
selects projects without any flag:

- In a project's root: that project and the projects below it.
- Anywhere inside a project, below its root: that project, plus any projects
  below the current directory.
- In a directory that belongs to no project: the projects below it.

```console
$ cd app/test && dagger check    # tests app, and only app
```

Project keys are always relative to the workspace root, wherever you run
Dagger from.

## Discovery

A project is any directory holding a `.mocharc.*` file (`.js`, `.cjs`, `.mjs`,
`.json`, `.jsonc`, `.yaml`, `.yml`); `node_modules` is not searched. A `mocha`
key in `package.json` also configures Mocha, but every npm package has a
`package.json`, so it does not mark a project.

A project's test files are found without running Mocha or starting a container:
one search (ripgrep) over the project, skipping `node_modules` and `.git`.
Discovery reads the config Mocha would load (`.mocharc.cjs`, `.js`, `.yaml`,
`.yml`, `.jsonc`, `.json`, in that order):

- `spec`: a string or a list of globs, files, files without their extension,
  and directories (`{a,b}` alternatives included). Without one, Mocha's
  default spec, the `./test` directory.
- A directory spec lists the files in it with the configured `extension`s
  (`js`, `cjs` and `mjs` by default), and the files below it too when
  `recursive` is set.

Files inside a nested project belong to that project, not to the enclosing
one. Keys are sorted. The limits of reading the config without running it:

- A JavaScript config is not evaluated, so its `spec`, `extension` and
  `recursive` are not seen and the defaults are listed instead. A
  whole-project run still uses it, since that run is Mocha's own.
- The `mocha` key of `package.json`, the `ignore` option, spec entries outside
  the project, and the `test` script in `package.json` are not read.
- Empty files are not listed.
- A project whose spec matches no file lists no test files, so `dagger check`
  does not run it. Call the project's `test` function to run it.

## Settings

Set these in your `dagger.toml`:

```toml
[modules.mochajs]
source = "github.com/dagger/mochajs"

# default: "node:25-alpine"; any image with Node.js
settings.baseImageAddress = "node:22"

# default: "" (detect per install root); or npm, pnpm, yarn, bun
settings.packageManager = "pnpm"

# default: false; run the package's build script before testing
settings.build = true

# default: []; extra flags passed to mocha
settings.flags = ["--exit"]

# default: []; extra flags passed to the install command
settings.installFlags = ["--ignore-scripts"]

# default: []; environment variables for Mocha, as KEY=VALUE
settings.environment = ["MONGOMS_DISTRO=ubuntu-22.04"]

# default: 1800; seconds a Mocha run may take, 0 for no limit
settings.timeout = 3600
```

Or from the CLI, where `dagger settings mochajs` lists them:

```console
$ dagger settings mochajs timeout 3600
$ dagger settings mochajs flags -- --exit     # "--" before values that start with "-"
$ dagger settings -u mochajs timeout          # unset: back to the default
```

`timeout` bounds each Mocha run, so a run that never ends fails instead of
holding `dagger check` forever. The default, 30 minutes, is well past what one
project's suite normally takes, and short enough to catch a hang in CI. The
usual cause of a hang is a test that leaves a handle open (a server, a
database connection, a timer): Mocha waits for the process to empty before it
exits. Many projects pass `--exit` in their `test` script for this; since that
script is not used here, set `settings.flags = ["--exit"]` or put `exit: true`
in the Mocha config.

### Tips

- **Native binaries.** The default image is Alpine (musl). Tools that download
  native binaries built for glibc, such as `mongodb-memory-server`, fail
  there: use a Debian-based image (`settings.baseImageAddress = "node:22"`).
  When the tool has no build for that distribution or architecture, point it
  at one through `environment`, e.g. `MONGOMS_DISTRO=ubuntu-22.04` for
  `mongodb-memory-server` on arm64.
- **Calling functions from the CLI.** `dagger call` cannot navigate
  collections yet; use the shell form:
  `dagger -c 'mochajs | projects | get app | list'`. Run the tests with
  `dagger check`, in CI especially: calling a check function through
  `dagger call` or `dagger -c` does not fail the command when the check fails.

## Using it from another module

`projects(ws)` returns the projects as a collection. Callers get `keys`,
`get(key:)`, `subset(keys:)`, `list`, and the collection's own functions under
`batch`:

| Function | What it does |
| --- | --- |
| `projects(ws).keys` | project roots |
| `projects(ws).batch.test(ws)` | run every project, whole; a plain function |
| `projects(ws).get(key: p).test(ws)` | run one project, whole; a plain function |
| `projects(ws).get(key: p).list(ws)` | the tests `mocha --dry-run` reports |
| `projects(ws).get(key: p).source(ws)` | the project's source directory |
| `projects(ws).get(key: p).tests(ws)` | the project's test files, as a collection |
| `tests.batch.test(ws)` | run the selected test files; a check |
| `tests.get(key: f).test(ws)` | run one test file; a check |

`test` on a project and the `projects` batch `test` are plain functions, not
checks, so `dagger check` does not run the same tests twice. A check called
through a dependency returns a `Check` that has not run yet. Run it and raise
its failure:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}

let tests = mochajs.projects(ws).get(key: "app").tests(ws)
run(tests.batch.test(ws))                                        # whole project
run(tests.subset(keys: ["test/add.test.js"]).batch.test(ws))     # only this file
```

## How the tracing works

Each run preloads this repository's `@dagger.io/mocha` library (below) with
`NODE_OPTIONS=--require …/register.cjs`, from where the module mounts it: the
project's dependencies and lockfile are not touched. It instruments the
project's own Mocha, 9 to 12, CommonJS or ESM.

# @dagger.io/mocha

Auto-instrumentation for Mocha tests with OpenTelemetry. It creates spans for:

- each suite that runs
- each test that runs (including pass/fail/pending status and duration)

Telemetry bootstrap, exporter, and context management are handled by `@dagger.io/telemetry`. This package only hooks Mocha and emits tracing data.

## Requirements

- Node.js 20+
- Mocha 9–12 (peer dependency)

## Install

- Using npm:
  - `npm install --save-dev @dagger.io/mocha`
- Using yarn:
  - `yarn add -D @dagger.io/mocha`
- Using pnpm:
  - `pnpm add -D @dagger.io/mocha`

The telemetry client (`@dagger.io/telemetry`) is a direct dependency and will be installed automatically.

## Usage

This library is designed to work by preloading a register file via `NODE_OPTIONS`.
It patches the Runner class of whichever Mocha the process loads: `lib/mocha.js`
up to Mocha 11, `lib/mocha.cjs` from Mocha 12.

- CommonJS (Node’s `--require`):
  - `NODE_OPTIONS="$NODE_OPTIONS --require @dagger.io/mocha/register" npx mocha`
- ESM (Node’s `--import`):
  - `NODE_OPTIONS="$NODE_OPTIONS --import @dagger.io/mocha/register" npx mocha`

You can also add it to your package.json `test` script:

- CommonJS:
  - `"test": "NODE_OPTIONS='--require @dagger.io/mocha/register' mocha"`
- ESM:
  - `"test": "NODE_OPTIONS='--import @dagger.io/mocha/register' mocha"`

This will:

- start the telemetry SDK before Mocha runs
- create spans for suites/tests as Mocha emits events
- attempt to gracefully shutdown and flush telemetry when the run ends

## What gets instrumented

Suite and test are instrumented. Spans are named after the suite or test
title.

- Suite span: one per suite, except the root suite
  - Status is set to ERROR if a test or a children suite is failed.
- Test span: one per test
  - Status is set to:
    - OK for passed tests
    - ERROR for failed tests (with recorded exception)

All spans are emitted under tracer name `dagger.io/mocha`.

## Developer guide

1. Build:

- `bun install`
- `bun run build`

2. Run the sample test:

- `cd tests/hello_world/register_esm`
- `npm install` (installs local `@dagger.io/mocha` via file dependency)
- Run the script or mocha inside a `dagger session`:
  - `NODE_OPTIONS="$NODE_OPTIONS --import @dagger.io/mocha/register" dagger run npx mocha`

You should see your spans appears in the TUI and on dagger cloud.

## License

Apache-2.0
