import { OtelSDK } from "@dagger.io/telemetry";
import type { Context, Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { RunnerOptions, Suite, Test } from "mocha";
import { Runner } from "mocha";

const tracer = trace.getTracer("dagger.io/mocha");

/**
 * Instrumentation for a test suite.
 */
type SuiteInst = {
  /**
   * The span of the suite.
   */
  span: Span;

  /**
   * The otel context of the suite.
   * This can be passed to children suite/tests.
   */
  context: Context;

  /**
   * Set to true if a children failed so the current span
   * status can be set to ERROR.
   */
  failed: boolean;
};

/**
 * Extension of mocha `Runner` to automatically instrument test and suites
 * based on node events.
 */
export class InstrumentedRunner extends Runner {
  /**
   * Define a static key to avoid double instantiation.
   */
  __dagger_instrumented__ = true;

  /**
   * Store otel related information to manage span lifecycles.
   */
  __suiteInst = new WeakMap<Suite, SuiteInst>();
  __testInst = new WeakMap<Test, Span>();

  constructor(suite: Suite, optionsOrDelay?: RunnerOptions | boolean) {
    super(suite, optionsOrDelay);

    const sdk = new OtelSDK();

    // Start the SDK
    this.on("start", () => {
      sdk.start();
    });

    // On suite start, create a span if it's not the root suite.
    this.on("suite", (suite: Suite) => {
      // Skip root suite
      if (suite.title === "") {
        return;
      }

      // Look up for a potential parent to get context
      const ctx = this.__getOrCreateContextFromParent(suite.parent);

      // Create the span and save it to close it after.
      const span = tracer.startSpan(suite.title, {}, ctx);
      const spanctx = trace.setSpan(ctx, span);

      this.__suiteInst.set(suite, {
        span,
        context: spanctx,
        failed: false,
      });
    });

    // On suite end, close the span and propagate the failure if possible.
    this.on("suite end", (suite: Suite) => {
      const testInst = this.__suiteInst.get(suite);
      if (testInst) {
        if (testInst.failed) {
          testInst.span.setStatus({ code: SpanStatusCode.ERROR });
          this.__setParentAsFailed(suite.parent);
        }

        testInst.span.end();
        this.__suiteInst.delete(suite);
      }
    });

    // On test running, start the span and execute the test function
    // inside the span's context.
    this.on("test", (test: Test) => {
      const ctx = this.__getOrCreateContextFromParent(test.parent);
      const span = tracer.startSpan(test.title, {}, ctx);

      this.__testInst.set(test, span);

      const original = test.fn;

      test.fn = function wrappedTestFn() {
        return context.with(trace.setSpan(ctx, span), () => {
          return (original as any).apply(this, arguments);
        });
      };
    });

    // On test success, set the status to OK.
    this.on("pass", (test: Test) => {
      const span = this.__testInst.get(test);
      if (span) {
        span.setStatus?.({ code: SpanStatusCode.OK });
      }
    });

    // On test failure, set the status to error and propagate the
    // error to the parent suite if there's.
    this.on("fail", (test: Test, err: any) => {
      const span = this.__testInst.get(test);
      if (span) {
        const message = err instanceof Error ? err.message : undefined;

        span.recordException(err);
        span.setStatus?.({ code: SpanStatusCode.ERROR, message });
        this.__setParentAsFailed(test.parent);
      }
    });

    // On test ending, end the span.
    this.on("test end", (test: Test) => {
      const span = this.__testInst.get(test);
      if (span) {
        span.end();
        this.__testInst.delete(test);
      }
    });

    // On test process ending, shutdown the telemetry to
    // flush remaining traces.
    this.on("end", async () => {
      await sdk.shutdown();
    });
  }

  private __getOrCreateContextFromParent(parent?: Suite): Context {
    if (!parent) {
      return context.active();
    }

    const _parent = this.__suiteInst.get(parent);
    if (!_parent) {
      return context.active();
    }

    return _parent.context;
  }

  private __setParentAsFailed(parent?: Suite): void {
    if (!parent) {
      return;
    }

    const _parent = this.__suiteInst.get(parent);
    if (_parent) {
      _parent.failed = true;
      this.__suiteInst.set(parent, _parent);
    }
  }
}
