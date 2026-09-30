import { OtelSDK } from "@dagger.io/telemetry";
import type { Context, Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Runner, RunnerOptions, Suite, Test } from "mocha";

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
 * The Runner class of the Mocha a project loaded. The instrumented runner has
 * to extend that class rather than a copy bundled here, so it runs the
 * project's own Mocha, whatever its version.
 */
export type RunnerClass = typeof Runner & { __dagger_instrumented__?: boolean };

/**
 * Extend a mocha `Runner` class to automatically instrument tests and suites
 * based on runner events.
 */
export function instrumentRunner(Base: RunnerClass): RunnerClass {
  return class InstrumentedRunner extends Base {
    /**
     * Marks the class as instrumented, to avoid patching it twice.
     */
    static __dagger_instrumented__ = true;

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

    __getOrCreateContextFromParent(parent?: Suite): Context {
      if (!parent) {
        return context.active();
      }

      const _parent = this.__suiteInst.get(parent);
      if (!_parent) {
        return context.active();
      }

      return _parent.context;
    }

    __setParentAsFailed(parent?: Suite): void {
      if (!parent) {
        return;
      }

      const _parent = this.__suiteInst.get(parent);
      if (_parent) {
        _parent.failed = true;
        this.__suiteInst.set(parent, _parent);
      }
    }
  };
}
