import assert from "node:assert";
import { trace } from "@opentelemetry/api";

describe("Array", function () {
  describe("#indexOf()", function () {
    it("should return -1 when the value is not present", function () {
      assert.equal([1, 2, 3].indexOf(4), -1);
    });
  });
});

it("it", async () => {
  trace.getTracer("it").startActiveSpan("hello inside it", (span) => {
    assert(1 + 1 === 2);
    span.end();
  });
});

describe("describe", () => {
  it("describe.it", () => {
    assert(1 + 1);
  });

  it("describe.it", () => {
    assert(1 + 1);
  });

  describe("describe.describe", () => {
    it("describe.describe.it", () => {
      assert(1 + 1);
    });

    it("describe.describe.it", () => {
      assert(1 + 1);
    });

    it("describe.describe.fail", () => {
      assert(1 === 2);
    });
  });
});

function add(args) {
  return args.reduce((prev, curr) => prev + curr, 0);
}

describe("add()", function () {
  const tests = [
    { args: [1, 2], expected: 3 },
    { args: [1, 2, 3], expected: 6 },
    { args: [1, 2, 3, 4], expected: 10 },
  ];

  tests.forEach(({ args, expected }) => {
    it(`correctly adds ${args.length} args`, function () {
      const res = add(args);
      assert.strictEqual(res, expected);
    });
  });
});
