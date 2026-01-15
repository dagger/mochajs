/* Auto-instrument Mocha when it's loaded by the process. */

import { Hook } from "require-in-the-middle";

import { InstrumentedRunner } from "./instrumented_runner";

function patchMocha(mochaExports: any) {
  if (!mochaExports || !mochaExports.Runner) {
    return mochaExports;
  }

  const OriginalRunner = mochaExports.Runner;

  // Avoid double patching
  if ((OriginalRunner as InstrumentedRunner).__dagger_instrumented__) {
    return mochaExports;
  }

  // Preserve static properties if Mocha sets any on Runner
  for (const key of Object.getOwnPropertyNames(OriginalRunner)) {
    if (["prototype", "name", "length"].includes(key)) continue;
    try {
      const desc = Object.getOwnPropertyDescriptor(OriginalRunner, key);
      if (desc) Object.defineProperty(InstrumentedRunner, key, desc);
    } catch {
      // non-critical
    }
  }

  mochaExports.Runner = InstrumentedRunner;

  return mochaExports;
}

// Hook CommonJS require('mocha') and require('mocha/lib/mocha')
new Hook(["mocha"], { internals: true }, (exports: any, name: string) => {
  try {
    // Hook the main mocha export OR the mocha.js internal file
    if (
      name === "mocha" ||
      name.endsWith("/mocha.js") ||
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
