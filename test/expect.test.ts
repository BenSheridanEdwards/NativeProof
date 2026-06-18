import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "../src/expect.js";

/**
 * Generic value matchers on expect(). UI/traffic matchers auto-wait and return
 * promises; value matchers assert a known value synchronously and `.not` inverts.
 */
test("expect(value) matchers pass for satisfied assertions (synchronous)", () => {
  expect(2 + 2).toBe(4);
  expect("native proof").toContain("proof");
  expect([1, 2, 3]).toContain(2);
  expect({ a: 1, b: [2] }).toEqual({ a: 1, b: [2] });
  expect("x").toBeTruthy();
  expect(0).toBeFalsy();
  expect(null).toBeNull();
  expect(1).toBeDefined();
});

test("expect(value).not inverts, and a failed matcher throws", () => {
  expect(2 + 2).not.toBe(5);
  expect("abc").not.toContain("z");
  expect({ a: 1 }).not.toEqual({ a: 2 });
  assert.throws(() => expect(1).toBe(2), /expect\(1\)\.toBe\(2\)/);
  assert.throws(() => expect("abc").not.toContain("a"), /toContain/);
});

test("expect(value).toContain throws a usage error on a non-string/array actual", () => {
  // A misused matcher should be a hard usage error, not a soft (negatable) failure.
  assert.throws(() => expect(42 as unknown).toContain(4), /needs a string or array/);
  assert.throws(() => expect({ a: 1 } as unknown).toContain("a"), /needs a string or array/);
});
