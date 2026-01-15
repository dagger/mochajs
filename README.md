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
