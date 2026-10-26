# Mocha

The Mocha module runs Mocha tests for JavaScript and TypeScript projects as a
Dagger check, locally, in CI, and in Dagger Cloud. Each Mocha config roots a
project, each project's test files are a collection, and so are the tests in
each file, so a check can run one test, one test file, one project, or
everything.

## Add it to your workspace

```bash
dagger module install dagger.io/js/mocha
```

It needs Dagger `v1.0.0-beta.16` or later, and Mocha 9 to 12 in the project's
`devDependencies`.

## Run the tests

```bash
dagger check --mochajs                                                      # every test of every project
dagger check --mochajs-project=app                                          # one project
dagger check --mochajs-project=app --mochajs-test-file=test/add.test.js     # one test file
dagger check --mochajs-test='add adds two numbers'                          # one test
```

The check is `mochajs/projects/test-files/tests/test`. It installs
dependencies and runs the project's own `mocha` once per test file, over the
selected tests. With every test of a file selected it runs that file and the
project's config selects the tests in it; with some selected it passes
`--grep`, anchored to the full titles selected, so a title another test's
title starts with does not pull that test in. Either way the file is named on
the command line, so the project's config applies minus its `spec`, which
Mocha would otherwise add to the files named there.

The module registers an OpenTelemetry hook, so suites and individual tests
appear as spans in the Dagger TUI and Dagger Cloud without changing the
project's Mocha config or its dependencies.

## Collections

| Flag | Collection | Key |
|------|-----------|-----|
| `--mochajs-project` | `projects` | Directory holding the Mocha config, relative to the workspace root. The root is `.` |
| `--mochajs-test-file` | `testFiles`, on a project | Test file path, relative to the project |
| `--mochajs-test` | `tests`, on a test file | Full title Mocha reports: the titles of the suites around a test, then its own |

List the keys with `dagger list mochajs-projects -a`,
`dagger list mochajs-test-files -a` and `dagger list mochajs-tests -a`. Each
collection also has an all form, `--mochajs-projects`, `--mochajs-test-files`
and `--mochajs-tests`. [Select collection items](/using/checking#select-collection-items)
describes how to select items.

A project is a directory holding `.mocharc.js`, `.cjs`, `.mjs`, `.json`,
`.jsonc`, `.yaml`, or `.yml`. Projects are found at or below the directory
`dagger` runs from, plus the nearest project that encloses it; `node_modules`
is not searched. A `mocha` key in `package.json` also configures Mocha, but
every npm package has a `package.json`, so it does not root a project.

Test files are found by one search over the project, reading the config's
`spec`, `extension`, and `recursive` when they are literal values, and
Mocha's default `./test` otherwise. A JavaScript config is not evaluated, so
its options are not seen. Files inside a nested project belong to that
project, and `node_modules`, `.git`, files ignored by `.gitignore`, and empty
files are left out. A project with no test files has nothing to run; call its
`test` function to run it anyway.

The tests of a file come from Mocha itself: one
`mocha --dry-run --reporter json` per project, which loads the test files
without running a test or a hook. The titles are the ones Mocha really uses,
including those a file computes as it loads, and a test the config or the
`flags` setting excludes is not a key. A file whose tests cannot be listed,
because it throws while Mocha loads it or because the install failed, keeps
the single key `*`, standing for the whole file: running it fails with the
reason.

Dependencies install at the nearest workspace root (a `pnpm-workspace.yaml`
or a `package.json` with `workspaces`), else the nearest lockfile, else the
nearest `package.json`. Mocha runs with the project as its working directory,
through the project's own `node_modules/.bin/mocha`, so workspace siblings
and shared configs resolve. A project with a `package.json` but no Mocha fails
and says so; a project with no `package.json` at or above it runs
`npx mocha`.

To print the tests Mocha discovers in a project, call its `list` function:

```bash
dagger -c 'mochajs | projects | get app | list'
```

## Configure it

List the current settings and their values with
`dagger module settings mochajs`, then set one with
`dagger module settings mochajs <key> <value>`. Settings are stored in
`dagger.toml` under `[modules.mochajs.settings]` and apply to every project:

- `packageManager` (default empty) is the package manager that installs
  dependencies: `npm`, `pnpm`, `yarn`, or `bun`. Empty detects it from the
  `packageManager` field of `package.json`, then from the lockfile, then uses
  npm.
- `baseImageAddress` (default `node:25-alpine`) is the Node base image tests
  run in. Pin it to the project's Node version, for example `node:22-alpine`.
  The default is Alpine (musl), so tools that download glibc binaries, such
  as `mongodb-memory-server`, need a Debian-based image.
- `build` (default `false`) runs the package's build script before testing.
- `flags` (default empty) are extra flags passed to every `mocha` run, such
  as `["--exit"]`.
- `installFlags` (default empty) are extra flags for the install command,
  such as `["--ignore-scripts"]`.
- `environment` (default empty) sets environment variables for the build and
  test steps, as `KEY=VALUE`.
- `timeout` (default `1800`) is the number of seconds a Mocha run may take
  before it is stopped and fails; `0` for no limit. A run that never ends
  usually has a test that left a handle open (a server, a connection, a
  timer): set `flags` to `["--exit"]`, or `exit: true` in the Mocha config.

```toml
[modules.mochajs.settings]
baseImageAddress = "node:22-alpine"
flags = ["--exit"]
timeout = 3600
```

The `test` script in `package.json` is not used, so flags it passes to Mocha
belong in the Mocha config or in `flags`.

## Working with other modules

Use this module when Mocha is the test runner. Use Jest or Vitest instead for
projects built around those runners.

[source code](https://github.com/dagger/mochajs)

---

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
| `projects(ws).get(key: p).testFiles(ws)` | the project's test files, as a collection |
| `files.batch.test(ws)` | run the selected test files; a plain function |
| `files.get(key: f).test(ws)` | run one test file; a plain function |
| `files.get(key: f).tests(ws)` | the file's tests, as a collection |
| `tests.batch.test(ws)` | run the selected tests of that file; a check |
| `tests.get(key: t).test(ws)` | run one test; a check |

Only the tests of a file are checks; everything above them is a plain
function, so `dagger check` does not run the same tests twice. A check called
through a dependency returns a `Check` that has not run yet. Run it and raise
its failure:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}

let files = mochajs.projects(ws).get(key: "app").testFiles(ws)
files.batch.test(ws)                                       # whole project; raises
files.subset(keys: ["test/add.test.js"]).batch.test(ws)    # only this file; raises

let tests = files.get(key: "test/add.test.js").tests(ws)
run(tests.batch.test(ws))                                  # the whole file
run(tests.subset(keys: ["add adds two numbers"]).batch.test(ws))   # only this test
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
