const assert = require("node:assert");

describe("cjs fixture", () => {
  it("passes", () => {
    assert.equal(1 + 1, 2);
  });

  describe("nested suite", () => {
    it("also passes", () => {
      assert.ok(true);
    });
  });
});
