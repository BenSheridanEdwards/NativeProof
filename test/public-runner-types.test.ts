import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Reporters } from "@wdio/types";
import { defineConfig } from "../src/config.js";

class CustomReporter extends EventEmitter {
  isSynchronised = true;

  constructor(_options: Partial<Reporters.Options>) {
    super();
  }
}

test("public runner types accept WDIO reporter classes and complete afterTest payloads", () => {
  const config = defineConfig({
    projects: [{ name: "ios", platform: "ios" }],
    reporters: [CustomReporter],
    afterTest: async (runnerTest, _context, result) => {
      const fullName: string = runnerTest.fullName;
      const file: string = runnerTest.file;
      const attempts: number = result.retries.attempts;
      const duration: number = result.duration;
      const status: string = result.status;
      const errorMessage: unknown = result.error?.message;
      void [fullName, file, attempts, duration, status, errorMessage];
    },
  });

  assert.equal(config.reporters?.[0], CustomReporter);
  assert.equal(typeof config.afterTest, "function");
});
