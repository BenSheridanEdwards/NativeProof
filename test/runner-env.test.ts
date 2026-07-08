import assert from "node:assert/strict";
import { test } from "node:test";
import { runnerEnvFromProcess } from "../src/runner-env.js";

function collectWarnings(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

test("runner env prefers NativeProof-prefixed selection vars", () => {
  const { warnings, warn } = collectWarnings();

  assert.deepEqual(
    runnerEnvFromProcess(
      {
        NATIVEPROOF_PLATFORM: "ios",
        PLATFORM: "android",
        NATIVEPROOF_PROJECT: "tablet",
        NATIVEPROOF_SPEC: "tests/login.spec.ts",
        SPEC: "tests/ambient.spec.ts",
      },
      { warn },
    ),
    {
      platform: "ios",
      project: "tablet",
      spec: "tests/login.spec.ts",
    },
  );
  assert.deepEqual(warnings, []);
});

test("runner env warns when legacy bare vars are used", () => {
  const { warnings, warn } = collectWarnings();

  assert.deepEqual(runnerEnvFromProcess({ PLATFORM: "ios", SPEC: "tests/login.spec.ts" }, { warn }), {
    platform: "ios",
    spec: "tests/login.spec.ts",
  });
  assert.deepEqual(warnings, [
    "nativeproof: PLATFORM is deprecated for runner selection; use NATIVEPROOF_PLATFORM instead",
    "nativeproof: SPEC is deprecated for runner selection; use NATIVEPROOF_SPEC instead",
  ]);
});
