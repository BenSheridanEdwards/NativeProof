import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { App, ScreenFactories } from "../src/app.js";
import {
  bootedIosSimulatorFromSimctl,
  buildWdioConfig,
  defineConfig,
  findConfigFile,
  resolveProject,
} from "../src/config.js";
import { captureText, failureEvidenceName, setArtifactDir } from "../src/evidence.js";

const android = {
  name: "android",
  platform: "android" as const,
  capabilities: { platformName: "Android", "appium:app": "a.apk" },
};
const ios = {
  name: "ios",
  platform: "ios" as const,
  capabilities: { platformName: "iOS", "appium:app": "A.app", "appium:deviceName": "iPhone 15" },
};
const projects = [android, ios];

test("defineConfig returns the config unchanged (typed identity)", () => {
  const app = {} as App<ScreenFactories>;
  const cfg = defineConfig({ app, projects });
  assert.equal(cfg.app, app);
  assert.equal(cfg.projects.length, 2);
  assert.equal(defineConfig({ projects }).app, undefined);
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
    {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:app": "A.app",
      "appium:deviceName": "iPhone 15",
    },
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
  const ios = buildWdioConfig(
    { projects: minimal, appium: { autoSelectBootedSimulator: false } },
    { project: "ios" },
    "/p",
  );
  assert.deepEqual(ios.capabilities, [{ platformName: "iOS", "appium:automationName": "Custom" }]);
});

test("bootedIosSimulatorFromSimctl picks the first booted available iOS simulator", () => {
  const raw = JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        { name: "iPhone 15", udid: "A", state: "Shutdown", isAvailable: true },
        { name: "iPhone 16", udid: "B", state: "Booted", isAvailable: true },
      ],
    },
  });

  assert.deepEqual(bootedIosSimulatorFromSimctl(raw), { name: "iPhone 16", udid: "B" });
  assert.equal(bootedIosSimulatorFromSimctl('{"devices":{}}'), null);
});

test("buildWdioConfig honours a spec override and Appium settings from config", () => {
  const wdio = buildWdioConfig(
    { projects, appium: { host: "1.2.3.4", port: 4444, path: "/" } },
    { spec: "tests/x.spec.ts" },
    "/proj",
  );
  assert.deepEqual(wdio.specs, ["/proj/tests/x.spec.ts"]);
  assert.equal(wdio.hostname, "1.2.3.4");
  assert.equal(wdio.port, 4444);
  assert.equal(wdio.path, "/");
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

test("buildWdioConfig lets nativeproof.config.ts own the artifact directory", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-artifacts-"));
  const configuredDir = path.join(dir, "configured");
  const envDir = path.join(dir, "env");
  const previous = process.env.E2E_ARTIFACT_DIR;
  try {
    process.env.E2E_ARTIFACT_DIR = envDir;
    buildWdioConfig({ projects, artifacts: { dir: configuredDir } }, { platform: "ios" }, "/proj");

    const target = await captureText("state.xml", '<node text="1234" />');
    assert.equal(target, path.join(configuredDir, "state.xml"));
    assert.match(readFileSync(target, "utf8"), /\[REDACTED\]/);
    assert.equal(existsSync(envDir), false);
  } finally {
    setArtifactDir(undefined);
    if (previous === undefined) {
      delete process.env.E2E_ARTIFACT_DIR;
    } else {
      process.env.E2E_ARTIFACT_DIR = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  }
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

test("resolveProject errors when an explicit platform has no matching project", () => {
  // Falling back to projects[0] silently ran the wrong platform for `--ios`.
  assert.throws(
    () => resolveProject({ projects }, { platform: "ios2" }),
    /no ios2 project in nativeproof\.config\.ts — available: .*android/,
  );
});
