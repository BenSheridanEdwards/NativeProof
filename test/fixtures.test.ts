import assert from "node:assert/strict";
import { test } from "node:test";
import { describeScenario, type ScenarioFixture, skipScenario } from "../src/fixtures.js";
import { type BddContext, type BddHooks, useRunner } from "../src/runner.js";

/**
 * describeScenario's onFailure seam, driven by a recording fake runner so we can run the
 * registered before/it by hand and assert the hook fires. node:test isolates each test
 * file in its own process, so wiring a fake runner here does not leak into other suites.
 */

function recordingRunner(): {
  its: Array<{ title: string; fn: () => Promise<void> }>;
  runSetup(): Promise<void>;
  runTeardown(): Promise<void>;
  setupSkipped(): boolean;
  behaviourSkipCount(): number;
} {
  const its: Array<{ title: string; fn: () => Promise<void> }> = [];
  let setup: (() => Promise<void>) | undefined;
  let teardown: (() => Promise<void>) | undefined;
  let setupWasSkipped = false;
  let behaviourSkips = 0;
  const setupContext: BddContext = {
    skip: () => {
      setupWasSkipped = true;
    },
  };
  const behaviourContext: BddContext = {
    skip: () => {
      behaviourSkips += 1;
    },
  };
  const hooks: BddHooks = {
    describe: (_title, fn) => fn(),
    before: (fn) => {
      setup = () => Promise.resolve(fn.call(setupContext));
    },
    after: (fn) => {
      teardown = () => Promise.resolve(fn.call({}));
    },
    it: (title, fn) => its.push({ title, fn: () => Promise.resolve(fn.call(behaviourContext)) }),
  };
  useRunner(hooks);
  return {
    its,
    runSetup: () => setup?.() ?? Promise.resolve(),
    runTeardown: () => teardown?.() ?? Promise.resolve(),
    setupSkipped: () => setupWasSkipped,
    behaviourSkipCount: () => behaviourSkips,
  };
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

test("skipScenario from setup skips behaviours and still runs teardown", async () => {
  const { its, runSetup, runTeardown, setupSkipped, behaviourSkipCount } = recordingRunner();
  let behaviourRan = false;
  let failureCaptured = false;
  let teardownContext: unknown = "not called";
  const fixture: ScenarioFixture<{ id: number }> = {
    async setup() {
      skipScenario("missing app seam");
    },
    async teardown(context) {
      teardownContext = context;
    },
    async onFailure() {
      failureCaptured = true;
    },
  };

  describeScenario("optional native seam", fixture, (t) => {
    t("would fail if it ran", async () => {
      behaviourRan = true;
      throw new Error("should not run");
    });
  });

  await runSetup();
  await runTeardown();
  const [only] = its;
  assert.ok(only);
  await only.fn();

  assert.equal(setupSkipped(), true);
  assert.equal(behaviourSkipCount(), 1);
  assert.equal(behaviourRan, false);
  assert.equal(failureCaptured, false);
  assert.equal(teardownContext, undefined);
});
