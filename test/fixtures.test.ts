import assert from "node:assert/strict";
import { test } from "node:test";
import { describeScenario, type ScenarioFixture } from "../src/fixtures.js";
import { type BddHooks, useRunner } from "../src/runner.js";

/**
 * describeScenario's onFailure seam, driven by a recording fake runner so we can run the
 * registered before/it by hand and assert the hook fires. node:test isolates each test
 * file in its own process, so wiring a fake runner here does not leak into other suites.
 */

function recordingRunner(): {
  its: Array<{ title: string; fn: () => Promise<void> }>;
  runSetup(): Promise<void>;
} {
  const its: Array<{ title: string; fn: () => Promise<void> }> = [];
  let setup: (() => Promise<void>) | undefined;
  const hooks: BddHooks = {
    describe: (_title, fn) => fn(),
    before: (fn) => {
      setup = fn as () => Promise<void>;
    },
    after: () => {},
    it: (title, fn) => its.push({ title, fn: fn as () => Promise<void> }),
  };
  useRunner(hooks);
  return { its, runSetup: () => setup?.() ?? Promise.resolve() };
}

test("onFailure fires with the failing behaviour's title + error and context, then rethrows", async () => {
  const { its, runSetup } = recordingRunner();
  const failures: Array<{ title: string; error: unknown; id: number }> = [];
  const fixture: ScenarioFixture<{ id: number }> = {
    async setup() {
      return { id: 7 };
    },
    async teardown() {},
    async onFailure(context, info) {
      failures.push({ title: info.title, error: info.error, id: context.id });
    },
  };

  describeScenario("scenario", fixture, (t) => {
    t("passes", async () => {});
    t("throws", async () => {
      throw new Error("boom");
    });
  });

  await runSetup(); // provision context
  const [passing, throwing] = its;
  assert.ok(passing && throwing);
  await passing.fn(); // passing behaviour → no onFailure
  await assert.rejects(() => throwing.fn(), /boom/); // throwing behaviour rethrows

  assert.equal(failures.length, 1);
  const [failure] = failures;
  assert.ok(failure);
  assert.equal(failure.title, "throws");
  assert.equal(failure.id, 7); // context injected
  assert.match(String(failure.error), /boom/);
});

test("a thrown onFailure hook is swallowed; the original error still propagates", async () => {
  const { its, runSetup } = recordingRunner();
  const fixture: ScenarioFixture<null> = {
    async setup() {
      return null;
    },
    async teardown() {},
    async onFailure() {
      throw new Error("hook exploded");
    },
  };
  describeScenario("s", fixture, (t) => {
    t("throws", async () => {
      throw new Error("real failure");
    });
  });
  await runSetup();
  const [only] = its;
  assert.ok(only);
  await assert.rejects(() => only.fn(), /real failure/); // not "hook exploded"
});
