# Mocha Dagger Toolchain

## Installation

```
dagger toolchain install github.com/dagger/mochajs
```

## Checks

The toolchain has one check, `test`, and it runs per test file:

```console
$ dagger check -l --all --mochajs                 # one line per project and test file
$ dagger check --mochajs --test                   # every project, each run whole
$ dagger check --mochajs --test --mochajs-project=packages/api
$ dagger check --mochajs --test --mochajs-project=packages/api --mochajs-test-file=test/auth.test.js
$ dagger check mochajs/projects/tests/test --mochajs-project=packages/api   # the same, by path
$ dagger list mochajs-projects
$ dagger list mochajs-test-files --mochajs-project=packages/api
```

`--test` alone also selects every other installed module's check named `test`;
`--mochajs` narrows it to this one. When another installed module also has a
`MochajsProject` or `MochajsTestFile` type the flags take a qualified name, so
`dagger check --help` lists the flags in effect.

`test` runs once per selected project. With every test file of a project
selected, it runs `npx mocha` in the project root as the project's own Mocha
config selects the tests. With some files filtered out, it runs only the
selected files: the project's config still applies, minus its `spec`, which
Mocha would otherwise add to the files named on the command line.

## API

- `projects(ws)`: the Mocha projects visible from the current directory, as a
  collection keyed by project root, relative to the workspace root.
- On a project: `tests(ws)` (its test files, as a collection keyed by path
  relative to the project root), `test(ws)` (run the whole project), `list(ws)`
  (the tests `mocha --dry-run` reports) and `source(ws)`.
- On a test file: `test(ws)`, a check.

`test` on a project, and the `projects` batch `test`, are plain functions
rather than checks, so `dagger check` does not run the same tests twice.

## Project discovery

Discovery is anchored at the directory you run Dagger from: `dagger check` tests
the project you are in and the projects beneath it. A project is any directory
holding a `.mocharc.*` file (`node_modules` excluded); a `mocha` key in
`package.json` also configures Mocha, but `package.json` marks every npm
package, so it is not a discovery marker.

```console
# from the workspace root of a monorepo holding a/ and b/
$ dagger list mochajs-projects -a    # -> a, b

# from a/
$ dagger list mochajs-projects -a    # -> a
```

A directory holding no config of its own sits inside its enclosing project, so
that project is listed and runs too. To run a single project, enter it or
select it with `--mochajs-project`. Project keys are always relative to the
workspace root, wherever you run Dagger from.

## Test file discovery

Test files are found by globbing the workspace, not by running Mocha, so
listing them starts no container. Discovery reads the config Mocha would load
(`.mocharc.cjs`, `.js`, `.yaml`, `.yml`, `.jsonc`, `.json`, in that order):

- From a JSON or YAML config it reads `spec` (a string or a list of globs,
  files and directories; `{a,b}` alternatives included), and `extension` and
  `recursive` for a directory spec.
- Otherwise it uses Mocha's default spec: `./test/*.{js,cjs,mjs}`, not
  recursive.

Files under `node_modules` and inside a nested project belong to neither
project's list. The limits of reading the config statically:

- A JavaScript config is not evaluated, so its `spec` is not seen and the
  default is listed instead. A whole-project run still uses it, since that is
  Mocha's own run.
- The `mocha` key of `package.json`, the `ignore` option, and spec entries
  outside the project are not read.
- A project whose spec matches no file lists no test files, so `dagger check`
  does not run it. Run it with the project's `test` function instead.

## Customization

The toolchain can be customized in your `dagger.toml` to meet your needs:

```toml
[modules.mochajs]
source = "github.com/dagger/mochajs"

# default: node:25-alpine; use any container image
settings.baseImageAddress = "node:22"

# default: npm; alternatively use yarn, pnpm, or bun
settings.packageManager = "yarn"

# default: false; run the package's build script before testing
settings.build = true

# default: []; extra flags passed to mocha
settings.flags = ["--bail"]
```

# @dagger.io/mocha

Auto-instrumentation for Mocha tests with OpenTelemetry. It creates spans for:

- each suite that runs
- each test that runs (including pass/fail/pending status and duration)

Telemetry bootstrap, exporter, and context management are handled by `@dagger.io/telemetry`. This package only hooks Mocha and emits tracing data.

## Requirements

- Node.js 20+
- Mocha 9–11 (peer dependency)

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

Suite and test are instrumented.

- Suite span: `mocha.suite`
  - Status is set to ERROR if a test or a children suite is failed.
- Test span: `mocha.test`
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
