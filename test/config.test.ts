import assert from "node:assert/strict";
import { test } from "node:test";
import type { App, ScreenFactories } from "../src/app.js";
import { buildWdioConfig, defineConfig, findConfigFile, resolveProject } from "../src/config.js";
import { failureEvidenceName } from "../src/evidence.js";

const android = {
  name: "android",
  platform: "android" as const,
  capabilities: { platformName: "Android", "appium:app": "a.apk" },
};
const ios = {
  name: "ios",
  platform: "ios" as const,
  capabilities: { platformName: "iOS", "appium:app": "A.app" },
};
const projects = [android, ios];

test("defineConfig returns the config unchanged (typed identity)", () => {
  const app = {} as App<ScreenFactories>;
  const cfg = defineConfig({ app, projects });
  assert.equal(cfg.app, app);
  assert.equal(cfg.projects.length, 2);
});

test("resolveProject picks by name, then platform, then the first project", () => {
  assert.equal(resolveProject({ projects }, { project: "ios" }).name, "ios");
  assert.equal(resolveProject({ projects }, { platform: "android" }).name, "android");
  assert.equal(resolveProject({ projects }, {}).name, "android");
  assert.throws(() => resolveProject({ projects }, { project: "nope" }), /no project named/);
  assert.throws(() => resolveProject({ projects: [] }, {}), /no `projects`/);
});

test("buildWdioConfig synthesises a WebdriverIO config with absolute specs for the platform", () => {
  const wdio = buildWdioConfig({ projects, testDir: "e2e" }, { platform: "ios" }, "/proj");
  assert.equal(wdio.framework, "mocha");
  assert.deepEqual(wdio.capabilities, [ios.capabilities]);
  assert.deepEqual(wdio.specs, ["/proj/e2e/**/*.spec.ts"]);
  assert.equal(wdio.path, "/wd/hub");
});

test("buildWdioConfig honours a spec override and Appium env", () => {
  const wdio = buildWdioConfig(
    { projects, appium: { port: 4444 } },
    { spec: "tests/x.spec.ts", appiumHost: "1.2.3.4" },
    "/proj",
  );
  assert.deepEqual(wdio.specs, ["/proj/tests/x.spec.ts"]);
  assert.equal(wdio.hostname, "1.2.3.4");
  assert.equal(wdio.port, 4444);
});

test("buildWdioConfig adds a built-in evidence-on-failure afterTest hook", async () => {
  const wdio = buildWdioConfig({ projects }, { platform: "android" }, "/proj");
  assert.equal(typeof wdio.afterTest, "function");
  const afterTest = wdio.afterTest as (t: unknown, c: unknown, r: { passed: boolean }) => Promise<void>;
  // A passing test captures nothing; a failing test attempts capture but never throws
  // (best-effort — no live device in this unit context).
  await afterTest({ title: "t", parent: "p" }, {}, { passed: true });
  await afterTest({ title: "t", parent: "p" }, {}, { passed: false });
});

test("failureEvidenceName builds a filesystem-safe, capped prefix", () => {
  assert.equal(
    failureEvidenceName({ parent: "Room · onboarding", title: "Accept is inert!" }),
    "failure-Room_onboarding-Accept_is_inert_",
  );
  assert.ok(failureEvidenceName({ parent: "x".repeat(200), title: "y" }).length <= 120);
});

test("findConfigFile locates nativeproof.config.* via the injected exists check", () => {
  const exists = (file: string) => file.endsWith("nativeproof.config.ts");
  assert.match(findConfigFile("/proj", exists) ?? "", /\/proj\/nativeproof\.config\.ts$/);
  assert.equal(
    findConfigFile("/proj", () => false),
    null,
  );
});
