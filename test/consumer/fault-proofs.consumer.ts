import { test } from "node:test";
import { faultProof } from "./harness.js";

test("missing runtime tsx is detected", () => faultProof("tsx"));
test("missing onboard entry is detected", () => faultProof("onboard"));

import assert from "node:assert/strict";
import path from "node:path";
import { consumer, run } from "./harness.js";

test("missing onboard command has a package diagnostic", () => {
  const fixture = consumer("onboard");
  try {
    assert.throws(
      () => run(path.join(fixture.cwd, "node_modules/.bin/nativeproof-onboard"), ["--help"], fixture.cwd),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes("UNAVAILABLE") &&
        /nativeproof-onboard/.test(error.message),
    );
  } finally {
    fixture.cleanup();
  }
});
test("local spawn errors are ordinary failures", () => {
  assert.throws(
    () => run("/nonexistent-nativeproof-command", [], process.cwd()),
    (error: unknown) => error instanceof Error && !error.message.includes("UNAVAILABLE"),
  );
});

test("missing public declarations are detected", () => faultProof("types" as "onboard"));
