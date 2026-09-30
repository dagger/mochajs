/* Auto-instrument Mocha when it's loaded by the process. */

import { Hook } from "require-in-the-middle";

import { instrumentRunner, type RunnerClass } from "./instrumented_runner";

function patchMocha(mochaExports: any) {
  const OriginalRunner: RunnerClass | undefined = mochaExports?.Runner;
  if (!OriginalRunner || OriginalRunner.__dagger_instrumented__) {
    return mochaExports;
  }

  // An ES module namespace (Mocha 12's `mocha` entry point, required from
  // CommonJS) is read-only; the CommonJS module behind it is patched instead.
  const desc = Object.getOwnPropertyDescriptor(mochaExports, "Runner");
  if (desc && !desc.writable && !desc.set) {
    return mochaExports;
  }

  mochaExports.Runner = instrumentRunner(OriginalRunner);

  return mochaExports;
}

// Hook require('mocha') and Mocha's own entry file: lib/mocha.js up to Mocha
// 11, lib/mocha.cjs from Mocha 12, which its CLI requires as "../mocha.cjs".
new Hook(["mocha"], { internals: true }, (exports: any, name: string) => {
  try {
    if (
      name === "mocha" ||
      name.endsWith("/mocha.js") ||
      name.endsWith("/mocha.cjs") ||
      name.endsWith("/lib/mocha")
    ) {
      return patchMocha(exports);
    }
    return exports;
  } catch (err) {
    console.log("[Dagger Mocha] Error during hook:", err);
    return exports;
  }
});
