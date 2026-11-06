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

It needs Dagger `v1.0.0-beta.22` or later, and Mocha 9 to 12 in the project's
`devDependencies`.

## Run the tests

```bash
dagger check --mochajs                                                      # every test of every project
dagger check --mochajs-project=app                                          # one project
dagger check --mochajs-project=app --mochajs-test-file=test/add.test.js     # one test file
dagger check --mochajs-test='add adds two numbers'                          # one test
```

The check is `mochajs/projects/test-files/tests/test`, one per test. All the
selected tests of a project share one Mocha run: every check of the project
builds the same command from the selection it is given, so Dagger runs it
once, with one install, and each check reads only its own result. With
nothing selected out anywhere, the run is the project as its Mocha config
selects it, as `npx mocha` would run it. Otherwise the selected files are
named on the command line, so the project's config applies minus its `spec`,
which Mocha would otherwise add to the files named there; and when tests were
selected out, Mocha gets one `--grep` anchored to the full titles selected,
so a title another test's title starts with does not pull that test in.

A check fails when its test fails. A hook that fails fails the selected tests
under its suite (and `*`, below), or every selected test of its file when none
is under it. A test the source does not name that fails, fails `*`, or every
selected test of its file when `*` is not selected. A named test Mocha never
ran fails as not run, rather than passing with nothing behind it; one left
without a result after another selected test of its file failed (`--bail`) is
not blamed. A `.only` in any file of a run holds the whole run, and Mocha
passes the tests it leaves out, so their checks pass too; under `forbidOnly`
(or `--forbid-only` in `flags`), Mocha throws as it loads the file that calls
`.only`, and that file's checks fail with the reason. Every check of a project fails when something outside its selected
files fails (a root hook, an error outside any test, or a file only the whole
run reaches, such as a JavaScript config's `spec` beyond what discovery
reads), or when Mocha times out or is missing. Mocha loads every file before
it runs one, so a file that throws while loading stops the run; the project's
selected files then run once more, each alone, so the tests of the file that
broke fail with the reason and the others report their own.

A `--grep`, `--fgrep` or `--invert` in `flags` or in the config filters the
keys the same way, so a test it excludes is no check. When the module passes
its own `--grep`, it folds that filter in and drops it from the command line,
since Mocha takes only one. A `/pattern/flags` form loses its flags, and a
pattern Go's regexp cannot compile leaves the keys unfiltered.

Results are cached by content, like any Dagger operation: an unchanged
project reuses its last run. Logs and test spans belong to the check that
started the shared run; the other checks share its result. Failure messages
keep the last 32 KiB of each stream.

The module registers an OpenTelemetry hook, so suites and individual tests
appear as spans in the Dagger TUI and Dagger Cloud without changing the
project's Mocha config or its dependencies.

## Collections

| Flag | Collection | Key |
|------|-----------|-----|
| `--mochajs-project` | `projects` | Directory holding the Mocha config, relative to the workspace root. The root is `.` |
| `--mochajs-test-file` | `testFiles`, on a project | Test file path, relative to the project |
| `--mochajs-test` | `tests`, on a test file | Full title as `--grep` matches it: the titles of the suites around a test, then its own, joined by spaces; or `*` |

List the keys with `dagger list mochajs-projects -a`,
`dagger list mochajs-test-files -a` and `dagger list mochajs-tests -a`. Each
collection also has an all form, `--mochajs-projects`, `--mochajs-test-files`
and `--mochajs-tests`. [Select collection items](/using/checking#select-collection-items)
describes how to select items.

Test titles are read from the source, without running Mocha. A test is named
when its title and its suites' titles are string literals (a template literal
without `${}` counts), and every scope around it is the file's top level, a
plain `{}` block, or the callback of a named suite. A test in a helper
function, a `forEach` or other callback, a hook or another test, or under a
suite whose title is computed, takes its title from its caller at run time,
so it is not named. Nor is a test that may not exist at all: one under `if`
or `else`, in a loop body, in `try`, `catch` or `finally`, in a `switch`, or
in a ternary or `&&`/`||` operand, much as Go never lists a test its build
constraints exclude. Each file with such tests has one more key, `*`, standing for exactly
those: selecting it runs every test of the file whose title is not one of its
named ones, and their failures are its own. A file whose tests are all named
has no `*`; a file whose tests are all unnamed has only `*`. When no unnamed test runs, `*` passes. The interface is read the same way, from
`--ui` in `flags` or `ui` in a JSON or YAML config: `bdd` (the default:
`describe`, `context`, `it`, `specify`, their `x` forms and `.only`/`.skip`)
and `tdd` (`suite`, `test`) are read; under `qunit`, `exports`, a custom
interface, or a JavaScript config, every file has only `*`.

A project is a directory holding `.mocharc.js`, `.cjs`, `.mjs`, `.json`,
`.jsonc`, `.yaml`, or `.yml`. Projects are found at or below the directory
`dagger` runs from, plus the nearest project that encloses it; `node_modules`
is not searched. A `mocha` key in `package.json` also configures Mocha, but
every npm package has a `package.json`, so it does not root a project.

Test files are found by searching the project's source, with no container:
listing never installs dependencies or runs Mocha. The search reads the
config's `spec`, `extension`, `recursive` and `ignore` when they are literal
values, and Mocha's default `./test` otherwise. A JavaScript config is not
evaluated, so its options are not seen. A file is a test file only when it
calls `describe`, `context`, `suite`, `it`, `specify` or `test`, so helpers
in the spec are not listed. Files inside a nested project belong to that
project, and `node_modules`, `.git` and files ignored by `.gitignore` are
left out. A project with no test files has nothing to run; call its `test`
function to run it anyway.

A project whose test files cannot be found, because its JSON or YAML config
does not parse, keeps one test file key, its config file, with the one test
`*`, whose check fails naming the file. Every other project is unaffected.

Dependencies install at the nearest workspace root (a `pnpm-workspace.yaml`
or a `package.json` with `workspaces`), else the nearest lockfile, else the
nearest `package.json`. Mocha runs with the project as its working directory,
through the project's own `node_modules/.bin/mocha`, so workspace siblings
and shared configs resolve. A project with a `package.json` but no Mocha fails
and says so; a project with no `package.json` at or above it runs
`npx mocha`.

To print the tests Mocha discovers in a project, which runs
`mocha --dry-run`, call its `list` function:

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
`get(key:)`, `subset(keys:)` and `list`, and call the collection's own
functions on it directly; there is no `batch` namespace:

| Function | What it does |
| --- | --- |
| `projects(ws).keys` | project roots |
| `projects(ws).test(ws)` | run every project, whole; a plain function |
| `projects(ws).get(key: p).test(ws)` | run one project, whole; a plain function |
| `projects(ws).get(key: p).list(ws)` | the tests `mocha --dry-run` reports |
| `projects(ws).get(key: p).source(ws)` | the project's source directory |
| `projects(ws).get(key: p).testFiles(ws)` | the project's test files, as a collection |
| `files.test(ws)` | run the selected test files; a plain function |
| `files.get(key: f).test(ws)` | run one test file; a plain function |
| `files.get(key: f).tests` | the file's tests, as a collection |
| `tests.test(ws)` | run the selected tests of that file; a plain function |
| `tests.get(key: t).test(ws, selection: files)` | one test's check, from the run of `selection` |

Only a test is a check; everything above it is a plain function, so `dagger
check` does not run the same tests twice. A test's check takes the selection
it shares a run with: `dagger check` passes the project's filtered test files,
and a direct call passes them itself. A direct call applies no `dagger check`
filter, so it runs every test of the files in `selection`. `tests` is now a
field rather than `tests(ws)`, and `tests.test(ws)` is a plain function that
raises rather than a check. A check called through a dependency returns a
`Check` that has not run yet. Run it and raise its failure:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}

let files = mochajs.projects(ws).get(key: "app").testFiles(ws)
files.test(ws)                                          # whole project; raises
files.subset(keys: ["test/add.test.js"]).test(ws)       # only this file; raises

let tests = files.get(key: "test/add.test.js").tests
tests.test(ws)                                          # the whole file; raises
tests.subset(keys: ["add adds two numbers"]).test(ws)   # only this test; raises
run(tests.get(key: "add adds two numbers").test(ws, selection: files))
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
