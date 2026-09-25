# Mocha Dagger Toolchain

Runs [Mocha](https://mochajs.org) tests as Dagger checks, one check per test
file, across every Mocha project in a workspace.

## Requirements

Dagger engine `v1.0.0-beta.15` or later. The module uses Dagger collections,
which older engines cannot load; until beta.15 is released, run it on a dev
engine.

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
| `--mochajs-test-file=PATH` | a test file, by its path relative to the project root (repeatable) |
| `--mochajs`, `--by-mochajs` | this module's checks |
| `--test`, `--check-test` | checks named `test`, in every installed module |

```console
$ dagger check -l --all --mochajs                  # one line per project and test file
$ dagger check --mochajs --test                    # every project, each run whole
$ dagger check --mochajs --test --mochajs-project=api
$ dagger check --mochajs --test --mochajs-project=api --mochajs-test-file=test/unit/t1.spec.js
$ dagger check mochajs/projects/tests/test --mochajs-project=api   # the same, by path
$ dagger list mochajs-projects -a
$ dagger list mochajs-test-files -a --mochajs-project=api
```

`--test` alone also selects every other installed module's check named `test`;
`--mochajs` narrows it to this one. When another installed module also has a
`MochajsProject` or `MochajsTestFile` type, the flags take a qualified name;
`dagger check --help` lists the flags in effect.

`test` runs once per selected project. With every test file of a project
selected, it runs `npx mocha` in the project root, and the project's own Mocha
config selects the tests. With some files filtered out, it runs only the
selected files: the project's config still applies, minus its `spec`, which
Mocha would otherwise add to the files named on the command line.

## Selecting by directory

Discovery starts from the directory you run Dagger in, so changing directory
selects projects without any flag:

- In a project's root: that project and the projects below it.
- Anywhere inside a project, below its root: that project, plus any projects
  below the current directory.
- In a directory that belongs to no project: the projects below it.

```console
$ cd api/test/unit && dagger check    # tests api, and only api
$ cd web && dagger check              # tests web and web/plugins/charts
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

- From a JSON or YAML config it reads `spec` (a string or a list of globs,
  files, files without their extension, and directories; `{a,b}` alternatives
  included), and `extension` and `recursive` for a directory spec.
- Otherwise it uses Mocha's default spec: `./test/*.{js,cjs,mjs}`, not
  recursive.

Files inside a nested project belong to that project, not to the enclosing
one. Keys are sorted. The limits of reading the config without running it:

- A JavaScript config is not evaluated, so its `spec` is not seen and the
  default is listed instead. A whole-project run still uses it, since that run
  is Mocha's own.
- The `mocha` key of `package.json`, the `ignore` option, and spec entries
  outside the project are not read.
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

# default: "npm"; alternatively yarn, pnpm, or bun
settings.packageManager = "yarn"

# default: false; run the package's build script before testing
settings.build = true

# default: []; extra flags passed to mocha
settings.flags = ["--bail"]
```

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

let tests = mochajs.projects(ws).get(key: "api").tests(ws)
run(tests.batch.test(ws))                                          # whole project
run(tests.subset(keys: ["test/unit/t1.spec.js"]).batch.test(ws))   # only this file
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
