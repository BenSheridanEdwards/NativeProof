import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { App, ScreenFactories } from "../src/app.js";
import {
  bootedIosSimulatorFromSimctl,
  buildWdioConfig,
  composeAfterTest,
  defineConfig,
  findConfigFile,
  resolveProject,
  splitSpecGlobs,
} from "../src/config.js";
import { captureStatePaths, captureText, failureEvidenceName, setArtifactDir } from "../src/evidence.js";

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
  assert.equal(wdio.path, "/");
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

test("buildWdioConfig exposes Android appium:udid to adb helpers", () => {
  const previous = process.env.ANDROID_SERIAL;
  try {
    delete process.env.ANDROID_SERIAL;
    const wdio = buildWdioConfig(
      {
        projects: [
          {
            name: "android",
            platform: "android",
            capabilities: { "appium:udid": "emulator-5556" },
          },
        ],
      },
      {},
      "/p",
    );

    assert.equal(process.env.ANDROID_SERIAL, "emulator-5556");
    assert.deepEqual(wdio.capabilities, [
      {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:udid": "emulator-5556",
      },
    ]);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_SERIAL;
    else process.env.ANDROID_SERIAL = previous;
  }
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

test("bootedIosSimulatorFromSimctl skips a booted watchOS runtime and picks the iOS one", () => {
  const raw = JSON.stringify({
    devices: {
      // A paired Apple Watch boots alongside the iPhone and sorts first by runtime id; pinning
      // its udid would fail XCUITest session creation, so it must be ignored.
      "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
        { name: "Apple Watch Series 10", udid: "W", state: "Booted", isAvailable: true },
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        { name: "iPhone 16", udid: "B", state: "Booted", isAvailable: true },
      ],
    },
  });

  assert.deepEqual(bootedIosSimulatorFromSimctl(raw), { name: "iPhone 16", udid: "B" });
});

test("splitSpecGlobs splits on commas but preserves brace globs", () => {
  assert.deepEqual(splitSpecGlobs("a.spec.ts, b.spec.ts"), ["a.spec.ts", "b.spec.ts"]);
  // The comma inside {login,signup} belongs to the brace expansion, not the glob list.
  assert.deepEqual(splitSpecGlobs("tests/{login,signup}.spec.ts"), ["tests/{login,signup}.spec.ts"]);
  assert.deepEqual(splitSpecGlobs("tests/{a,b}.spec.ts, other.spec.ts"), [
    "tests/{a,b}.spec.ts",
    "other.spec.ts",
  ]);
  // A trailing comma leaves no empty glob behind.
  assert.deepEqual(splitSpecGlobs("only.spec.ts,"), ["only.spec.ts"]);
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

test("buildWdioConfig forwards runner-native retries, reporters and Mocha options", () => {
  const afterTest = async (): Promise<void> => {};
  const wdio = buildWdioConfig(
    {
      projects,
      specFileRetries: 2,
      specFileRetriesDelay: 5,
      specFileRetriesDeferred: false,
      reporters: ["spec", ["junit", { outputDir: "reports" }]],
      mochaOpts: {
        grep: "@smoke",
        invert: true,
        retries: 1,
        require: ["./tests/setup.ts"],
        timeout: 30_000,
      },
      afterTest,
    },
    {},
    "/p",
  );

  assert.equal(wdio.specFileRetries, 2);
  assert.equal(wdio.specFileRetriesDelay, 5);
  assert.equal(wdio.specFileRetriesDeferred, false);
  assert.deepEqual(wdio.reporters, ["spec", ["junit", { outputDir: "reports" }]]);
  assert.deepEqual(wdio.mochaOpts, {
    ui: "bdd",
    timeout: 30_000,
    grep: "@smoke",
    invert: true,
    retries: 1,
    require: ["./tests/setup.ts"],
  });
  assert.notEqual(wdio.afterTest, afterTest, "the user hook is composed instead of replacing capture");
});

test("CLI grep overrides config grep without replacing other Mocha options", () => {
  const wdio = buildWdioConfig(
    {
      projects,
      mochaOpts: { grep: "@regression", retries: 2, timeout: 20_000 },
    },
    { grep: "@smoke" },
    "/p",
  );

  assert.deepEqual(wdio.mochaOpts, {
    ui: "bdd",
    timeout: 20_000,
    grep: "@smoke",
    retries: 2,
  });
});

test("an explicit empty CLI grep clears config grep without replacing other Mocha options", () => {
  const wdio = buildWdioConfig(
    {
      projects,
      mochaOpts: { grep: "@regression", retries: 2, timeout: 20_000 },
    },
    { grep: "" },
    "/p",
  );

  assert.deepEqual(wdio.mochaOpts, {
    ui: "bdd",
    timeout: 20_000,
    grep: "",
    retries: 2,
  });
});

test("composeAfterTest reports exact saved failure evidence before the consumer hook", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-failure-evidence-"));
  const events: string[] = [];
  const runnerTest = {
    type: "test",
    title: "fails",
    parent: "suite",
    fullTitle: "suite fails",
    fullName: "suite fails",
    pending: false,
    file: "/proj/tests/login.spec.ts",
    ctx: {},
  };
  try {
    const pngPath = path.join(dir, "failure.png");
    const xmlPath = path.join(dir, "failure.xml");
    const records: unknown[] = [];
    const hook = composeAfterTest(
      async () => {
        events.push("consumer");
      },
      async () => {
        events.push("capture");
        writeFileSync(pngPath, "png");
        writeFileSync(xmlPath, "<source />");
        return { pngPath, xmlPath };
      },
      {
        project: "ios",
        onFailureEvidence(record) {
          events.push("evidence");
          records.push(record);
        },
      },
    );

    await hook(
      runnerTest,
      {},
      {
        passed: false,
        duration: 1,
        retries: { limit: 1, attempts: 1 },
        exception: "failure",
        status: "failed",
      },
    );
    assert.deepEqual(events, ["capture", "evidence", "consumer"]);
    assert.deepEqual(records, [
      {
        project: "ios",
        file: "/proj/tests/login.spec.ts",
        fullName: "suite fails",
        attempt: 1,
        pngPath,
        xmlPath,
      },
    ]);
    assert.equal(existsSync(pngPath), true);
    assert.equal(existsSync(xmlPath), true);

    events.length = 0;
    await hook(
      { ...runnerTest, title: "passes", fullTitle: "suite passes", fullName: "suite passes" },
      {},
      {
        passed: true,
        duration: 1,
        retries: { limit: 1, attempts: 0 },
        exception: "",
        status: "passed",
      },
    );
    assert.deepEqual(events, ["consumer"]);
    assert.equal(records.length, 1, "passing tests emit no failure-evidence callback");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("composeAfterTest reports no fictitious paths when capture fails and preserves the failure", async () => {
  const events: string[] = [];
  const runnerTest = {
    type: "test",
    title: "fails",
    parent: "suite",
    fullTitle: "suite fails",
    fullName: "suite fails",
    pending: false,
    file: "/proj/fail.spec.ts",
    ctx: {},
  };
  const result = {
    passed: false,
    duration: 1,
    retries: { limit: 0, attempts: 0 },
    exception: "failure",
    status: "failed",
  };
  let consumerResult: unknown;
  const hook = composeAfterTest(
    async (_test, _context, receivedResult) => {
      events.push("consumer");
      consumerResult = receivedResult;
    },
    async () => {
      events.push("capture");
      throw new Error("device disconnected during evidence capture");
    },
    {
      project: "android",
      onFailureEvidence() {
        events.push("evidence");
      },
    },
  );

  await hook(runnerTest, {}, result);
  assert.deepEqual(events, ["capture", "consumer"]);
  assert.equal(consumerResult, result);
});

test("source-read rejection emits no complete evidence record and preserves the failed result", async () => {
  const events: string[] = [];
  const sourceError = new Error("page source unavailable");
  const captureFailure = async (prefix: string) =>
    captureStatePaths(prefix, {
      async getPageSource() {
        events.push("source");
        throw sourceError;
      },
      async captureScreenshot(filename) {
        events.push(`screenshot:${filename}`);
        return `/artifacts/${filename}`;
      },
      async captureText(filename) {
        events.push(`source-file:${filename}`);
        return `/artifacts/${filename}`;
      },
    });
  const runnerTest = {
    type: "test",
    title: "fails",
    parent: "suite",
    fullTitle: "suite fails",
    fullName: "suite fails",
    pending: false,
    file: "/proj/source-failure.spec.ts",
    ctx: {},
  };
  const result = {
    passed: false,
    duration: 1,
    retries: { limit: 0, attempts: 0 },
    exception: "original failure",
    status: "failed",
  };
  let consumerResult: unknown;
  const hook = composeAfterTest(
    async (_test, _context, receivedResult) => {
      events.push("consumer");
      consumerResult = receivedResult;
    },
    captureFailure,
    {
      project: "ios",
      onFailureEvidence() {
        events.push("evidence");
      },
    },
  );

  await assert.rejects(() => captureFailure("direct-source-failure"), sourceError);
  events.length = 0;
  await hook(runnerTest, {}, result);

  assert.deepEqual(events, ["source", "consumer"]);
  assert.equal(consumerResult, result);
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

test("failureEvidenceName is safe, capped and unique across file, project and retry identity", () => {
  assert.match(
    failureEvidenceName({ parent: "Room · onboarding", title: "Accept is inert!" }),
    /^failure-Room_onboarding-Accept_is_inert_-[a-f0-9]{64}$/,
  );
  const first = failureEvidenceName({ parent: "x".repeat(200), title: "one" });
  const second = failureEvidenceName({ parent: "x".repeat(200), title: "two" });
  assert.ok(first.length <= 120);
  assert.ok(second.length <= 120);
  assert.notEqual(first, second);

  const testIdentity = {
    parent: "Login",
    title: "rejects bad password",
    fullName: "Login rejects bad password",
    file: "/proj/tests/login.spec.ts",
    project: "android",
    attempt: 0,
  };
  const identities = [
    testIdentity,
    { ...testIdentity, file: "/proj/tests/admin-login.spec.ts" },
    { ...testIdentity, project: "ios" },
    { ...testIdentity, attempt: 1 },
  ];
  assert.equal(new Set(identities.map(failureEvidenceName)).size, identities.length);
});

test("failureEvidenceName distinguishes the exact known 32-bit digest collision", () => {
  const identity = {
    parent: "Login",
    title: "rejects bad password",
    fullName: "Login rejects bad password",
    project: "android",
    attempt: 0,
  };
  const knownCollision = [
    { ...identity, file: "/proj/tests/case-64394.spec.ts" },
    { ...identity, file: "/proj/tests/case-84739.spec.ts" },
  ].map(failureEvidenceName);
  assert.notEqual(knownCollision[0], knownCollision[1]);
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
