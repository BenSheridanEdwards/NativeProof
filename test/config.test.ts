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
  // The project's caps, with the platform's automationName defaulted in (XCUITest for iOS).
  assert.deepEqual(wdio.capabilities, [
    { platformName: "iOS", "appium:automationName": "XCUITest", "appium:app": "A.app" },
  ]);
  assert.deepEqual(wdio.specs, ["/proj/e2e/**/*.spec.ts"]);
  assert.equal(wdio.path, "/wd/hub");
});

test("buildWdioConfig defaults platformName + automationName per platform, and a project's caps win", () => {
  const minimal = [
    { name: "android", platform: "android" as const }, // no capabilities at all
    { name: "ios", platform: "ios" as const, capabilities: { "appium:automationName": "Custom" } },
  ];
  const android = buildWdioConfig({ projects: minimal }, { project: "android" }, "/p");
  assert.deepEqual(android.capabilities, [
    { platformName: "Android", "appium:automationName": "UiAutomator2" },
  ]);
  // A project's own automationName overrides the platform default.
  const ios = buildWdioConfig({ projects: minimal }, { project: "ios" }, "/p");
  assert.deepEqual(ios.capabilities, [{ platformName: "iOS", "appium:automationName": "Custom" }]);
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

test("buildWdioConfig uses a project's own specs (per-platform sets), and --spec wins", () => {
  const perProject = [
    {
      name: "android",
      platform: "android" as const,
      specs: ["e2e/shared/**/*.spec.ts", "e2e/android/**/*.spec.ts"],
    },
    {
      name: "ios",
      platform: "ios" as const,
      specs: ["e2e/shared/**/*.spec.ts", "e2e/ios/**/*.spec.ts"],
    },
  ];
  const android = buildWdioConfig({ projects: perProject }, { project: "android" }, "/p");
  assert.deepEqual(android.specs, ["/p/e2e/shared/**/*.spec.ts", "/p/e2e/android/**/*.spec.ts"]);
  const ios = buildWdioConfig({ projects: perProject }, { project: "ios" }, "/p");
  assert.deepEqual(ios.specs, ["/p/e2e/shared/**/*.spec.ts", "/p/e2e/ios/**/*.spec.ts"]);
  // A --spec override (comma-separated) wins over the project's specs.
  const override = buildWdioConfig(
    { projects: perProject },
    { project: "android", spec: "a.spec.ts, b.spec.ts" },
    "/p",
  );
  assert.deepEqual(override.specs, ["/p/a.spec.ts", "/p/b.spec.ts"]);
  // A project with no specs falls back to testDir/testMatch.
  const fallback = buildWdioConfig(
    { projects: [{ name: "x", platform: "android" as const }], testDir: "e2e" },
    {},
    "/p",
  );
  assert.deepEqual(fallback.specs, ["/p/e2e/**/*.spec.ts"]);
});

test("buildWdioConfig forwards wdio tuning options only when set", () => {
  const bare = buildWdioConfig({ projects: [{ name: "a", platform: "android" as const }] }, {}, "/p");
  for (const key of [
    "connectionRetryTimeout",
    "connectionRetryCount",
    "waitforTimeout",
    "bail",
    "logLevel",
  ]) {
    assert.equal(bare[key], undefined, `${key} omitted unless set (wdio default applies)`);
  }
  const tuned = buildWdioConfig(
    {
      projects: [{ name: "a", platform: "android" as const }],
      connectionRetryTimeout: 300_000,
      connectionRetryCount: 1,
      waitforTimeout: 15_000,
      bail: 0, // 0 is meaningful (never bail) and must still be forwarded
      logLevel: "warn",
    },
    {},
    "/p",
  );
  assert.equal(tuned.connectionRetryTimeout, 300_000);
  assert.equal(tuned.connectionRetryCount, 1);
  assert.equal(tuned.waitforTimeout, 15_000);
  assert.equal(tuned.bail, 0);
  assert.equal(tuned.logLevel, "warn");
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
