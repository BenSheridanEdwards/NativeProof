import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  appiumDriverListHasDriver,
  appiumDriverNameForPlatform,
  defaultCommandForProgram,
  detectOnboardTarget,
  ensureAppiumDriver,
  helpText,
  loadNativeProofConfig,
  main,
  type NativeBuildCommandRunner,
  onboard,
  onboardCommand,
  parseArgs,
  resolveRunner,
  runSelection,
  type ScaffoldIo,
  scaffold,
  scaffoldFiles,
  selectIosScheme,
  updateConfigAppPath,
  version,
  waitForRunnerExit,
} from "../src/cli.js";

/**
 * CLI argument parsing + runner resolution — pure, no spawning. Importing the module
 * does not run `main` (it is guarded to only execute when the file is the process entry).
 */
test("parseArgs defaults to the test command with sensible defaults", () => {
  const args = parseArgs([]);
  assert.equal(args.command, "test");
  assert.equal(args.project, undefined);
  assert.equal(args.startAppium, true);
  assert.equal(args.platform, undefined);
  assert.equal(args.initPlatform, undefined);
});

test("parseArgs reads platform, project, spec and --no-appium", () => {
  const args = parseArgs([
    "test",
    "--platform",
    "ios",
    "--project",
    "tablet",
    "--spec",
    "a.spec.ts",
    "--no-appium",
  ]);
  assert.equal(args.platform, "ios");
  assert.equal(args.initPlatform, "ios");
  assert.equal(args.project, "tablet");
  assert.equal(args.spec, "a.spec.ts");
  assert.equal(args.startAppium, false);
});

test("parseArgs surfaces --help and --version", () => {
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["-v"]).command, "version");
});

test("parseArgs rejects an invalid platform, a missing value, and unknown flags", () => {
  assert.throws(() => parseArgs(["--platform", "windows"]), /android.*ios/);
  assert.throws(() => parseArgs(["init", "--ios", "--android"]), /conflicts/);
  assert.throws(() => parseArgs(["--config", "wdio.conf.ts"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--appium-host", "10.0.0.5"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
});

test("resolveRunner errors when no config is discoverable", () => {
  assert.throws(
    () => resolveRunner(parseArgs([]), "/tmp/nativeproof-nonexistent-xyz"),
    /no nativeproof\.config/,
  );
});

test("resolveRunner ignores raw WebdriverIO configs and requires nativeproof.config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    writeFileSync(path.join(dir, "wdio.conf.ts"), "export const config = {};\n");
    assert.throws(() => resolveRunner(parseArgs([]), dir), /no nativeproof\.config/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNativeProofConfig imports a TypeScript config", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    const configPath = path.join(dir, "nativeproof.config.ts");
    writeFileSync(
      configPath,
      [
        "const port: number = 4724;",
        'export default { appium: { host: "10.0.0.5", port, path: "/" }, projects: [{ name: "android", platform: "android" }] };',
      ].join("\n"),
    );
    const config = await loadNativeProofConfig(configPath);
    assert.equal(config.appium?.host, "10.0.0.5");
    assert.equal(config.appium?.port, 4724);
    assert.equal(config.appium?.path, "/");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNativeProofConfig imports a generated-style config that imports nativeproof", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-package-import-"));
  try {
    const packageDir = path.join(dir, "node_modules", "nativeproof");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "nativeproof", type: "module", exports: "./index.js" }),
    );
    writeFileSync(
      path.join(packageDir, "index.js"),
      "export function defineConfig(config) { return config; }\nexport const expect = () => undefined;\nexport const native = {};\nexport const createNative = () => native;\nexport const wdioDriver = () => undefined;\n",
    );
    const configPath = path.join(dir, "nativeproof.config.ts");
    writeFileSync(
      configPath,
      [
        'import { defineConfig } from "nativeproof";',
        'export default defineConfig({ projects: [{ name: "ios", platform: "ios" }] });',
      ].join("\n"),
    );

    const config = await loadNativeProofConfig(configPath);
    assert.equal(config.projects[0]?.name, "ios");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNativeProofConfig errors when the config has no default export", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    const configPath = path.join(dir, "nativeproof.config.ts");
    writeFileSync(configPath, "export const nope = 1;\n");
    await assert.rejects(() => loadNativeProofConfig(configPath), /export default defineConfig/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helpText names the native E2E layer and version is semver", () => {
  assert.match(helpText(), /Playwright-feeling native mobile E2E/);
  assert.match(version(), /^\d+\.\d+\.\d+$/);
});

test("package carries the runtime reporter dependency used by generated WDIO config", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };

  assert.equal(typeof pkg.dependencies?.["@wdio/spec-reporter"], "string");
});

test("Appium driver helpers map platforms and parse installed-driver output", () => {
  assert.equal(appiumDriverNameForPlatform("android"), "uiautomator2");
  assert.equal(appiumDriverNameForPlatform("ios"), "xcuitest");
  assert.equal(appiumDriverListHasDriver('{"xcuitest":{"version":"1.0.0"}}', "xcuitest"), true);
  assert.equal(appiumDriverListHasDriver("{}", "xcuitest"), false);
  assert.equal(appiumDriverListHasDriver("not json", "xcuitest"), false);
  // npm notices / Appium update-check warnings can share stdout with the JSON object; the driver
  // must still be detected so an installed driver is not needlessly reinstalled.
  const noisy = [
    "npm notice New major version of npm available!",
    '{"xcuitest":{"version":"9.0.0","installed":true}}',
    "",
  ].join("\n");
  assert.equal(appiumDriverListHasDriver(noisy, "xcuitest"), true);
});

test("ensureAppiumDriver installs the missing platform driver unless config opts out", async () => {
  const calls: Array<{ args: readonly string[]; stdio: string | undefined }> = [];
  const runCommand = async (
    args: readonly string[],
    options?: { stdio?: "pipe" | "inherit" },
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    calls.push({ args, stdio: options?.stdio });
    if (args.includes("list")) return { code: 0, stdout: "{}", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };

  assert.equal(await ensureAppiumDriver("android", {}, runCommand), true);
  assert.deepEqual(calls, [
    { args: ["driver", "list", "--installed", "--json"], stdio: undefined },
    { args: ["driver", "install", "uiautomator2"], stdio: "inherit" },
  ]);

  calls.length = 0;
  assert.equal(await ensureAppiumDriver("android", { autoInstallDrivers: false }, runCommand), false);
  assert.deepEqual(calls, []);
});

test("ensureAppiumDriver skips install when the platform driver already exists", async () => {
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];
  const runCommand = async (
    args: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    mutableCalls.push([...args]);
    return { code: 0, stdout: '{"uiautomator2":{"version":"1.0.0"}}', stderr: "" };
  };

  assert.equal(await ensureAppiumDriver("android", {}, runCommand), false);
  assert.deepEqual(calls, [["driver", "list", "--installed", "--json"]]);
});

class FakeChildProcess extends EventEmitter {
  killed = false;
  readonly killedSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.killedSignals.push(signal);
    return true;
  }
}

test("waitForRunnerExit kills WDIO and Appium children on SIGTERM", async () => {
  const runner = new FakeChildProcess();
  const appium = new FakeChildProcess();
  const signals = new EventEmitter();
  const result = waitForRunnerExit(runner, appium, signals);

  signals.emit("SIGTERM", "SIGTERM");

  assert.equal(await result, 143);
  assert.deepEqual(runner.killedSignals, ["SIGTERM"]);
  assert.deepEqual(appium.killedSignals, ["SIGTERM"]);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("parseArgs surfaces the init command, and help lists it", () => {
  const args = parseArgs(["init", "--ios"]);
  assert.equal(args.command, "init");
  assert.equal(args.initPlatform, "ios");
  assert.match(helpText(), /nativeproof init --ios/);
  assert.match(helpText(), /nativeproof init --android/);
  assert.match(helpText(), /nativeproof-init --ios/);
  assert.match(helpText(), /nativeproof-init --android/);
});

test("parseArgs surfaces the onboard command, and help lists it", () => {
  const args = parseArgs(["onboard", "./build/ios/MyApp.app", "--ios"]);
  assert.equal(args.command, "onboard");
  assert.equal(args.onboardPath, "./build/ios/MyApp.app");
  assert.equal(args.platform, "ios");
  assert.match(helpText(), /nativeproof onboard <path>/);
  assert.match(helpText(), /nativeproof-onboard <path>/);
});

test("parseArgs treats a bare word after a command as a positional, not a second command", () => {
  // `onboard test` should onboard a path named `test`, not silently switch to the test command.
  const args = parseArgs(["onboard", "test"]);
  assert.equal(args.command, "onboard");
  assert.equal(args.onboardPath, "test");
});

test("nativeproof-init defaults to the init command", () => {
  assert.equal(defaultCommandForProgram("nativeproof"), "test");
  assert.equal(defaultCommandForProgram("nativeproof-init"), "init");
  assert.equal(defaultCommandForProgram("nativeproof-init.cmd"), "init");
  assert.equal(defaultCommandForProgram("nativeproof-onboard"), "onboard");
  assert.equal(defaultCommandForProgram("nativeproof-onboard.cmd"), "onboard");

  const args = parseArgs(["--android"], { defaultCommand: defaultCommandForProgram("nativeproof-init") });
  assert.equal(args.command, "init");
  assert.equal(args.platform, "android");
  assert.equal(args.initPlatform, "android");

  const explicitTest = parseArgs(["test", "--ios"], {
    defaultCommand: defaultCommandForProgram("nativeproof-init"),
  });
  assert.equal(explicitTest.command, "test");
  assert.equal(explicitTest.platform, "ios");
});

test("main rejects init without an explicit platform", async () => {
  await assert.rejects(() => main(["init"]), /init requires --ios or --android/);
});

test("main rejects onboard without an app path", async () => {
  await assert.rejects(() => main(["onboard"]), /onboard requires a path/);
});

test("scaffoldFiles are a platform-specific config, package script and readable spec", () => {
  const files = scaffoldFiles({ platform: "ios" });
  const config = files.find((f) => f.path === "nativeproof.config.ts");
  const spec = files.find((f) => f.path === "tests/example.spec.ts");
  const pkg = files.find((f) => f.path === "package.json");
  assert.ok(config, "writes nativeproof.config.ts");
  assert.ok(spec, "writes a sample spec");
  assert.ok(pkg, "writes package.json with an npm script");
  // The config owns app/device control and exports the direct native surface specs use.
  assert.match(config.contents, /createNative\(/);
  assert.match(config.contents, /export const native/);
  assert.match(config.contents, /export default defineConfig\(/);
  assert.match(config.contents, /platform: "ios"/);
  assert.doesNotMatch(config.contents, /platform: "android"/);
  assert.match(config.contents, /artifacts: \{ dir: "\.e2e-artifacts" \}/);
  assert.match(config.contents, /autoInstallDrivers: true/);
  assert.match(config.contents, /autoSelectBootedSimulator: true/);
  assert.match(config.contents, /"appium:app": "\.\/build\/ios\/MyApp\.app"/);
  assert.doesNotMatch(config.contents, /"appium:deviceName": "iPhone 15"/);
  assert.doesNotMatch(config.contents, /process\.env\.NATIVEPROOF/);
  // The spec imports the config-owned native surface and uses runner-native words.
  assert.match(spec.contents, /from "\.\.\/nativeproof\.config"/);
  assert.match(spec.contents, /describe\("login"/);
  assert.match(spec.contents, /it\("should be able to log in"/);
  assert.match(spec.contents, /native\.tap\("Log in"\)/);
  assert.doesNotMatch(spec.contents, /test\.describe\(/);
  assert.match(pkg.contents, /"type": "module"/);
  assert.match(pkg.contents, /"test:e2e": "nativeproof"/);
});

test("scaffoldFiles can pin the onboarded app path in config", () => {
  const files = scaffoldFiles({ platform: "android", appPath: "/apps/Example.apk" });
  const config = files.find((f) => f.path === "nativeproof.config.ts");
  assert.ok(config, "writes nativeproof.config.ts");
  assert.match(config.contents, /"appium:app": "\/apps\/Example\.apk"/);
});

test("scaffold writes missing files and never overwrites existing ones", () => {
  const written = new Map<string, string>();
  const present = new Set<string>(["/proj/nativeproof.config.ts"]); // config already exists
  const io: ScaffoldIo = {
    exists: (file) => present.has(file),
    read: () => {
      throw new Error("read should not be called for missing package.json");
    },
    write: (file, contents) => written.set(file, contents),
  };
  const { created, skipped, updated } = scaffold("/proj", { platform: "android" }, io);
  assert.deepEqual(created, ["tests/example.spec.ts", "package.json"]);
  assert.deepEqual(skipped, ["nativeproof.config.ts"]); // existing one left intact
  assert.deepEqual(updated, []);
  assert.equal(written.has("/proj/nativeproof.config.ts"), false);
  assert.ok(written.get("/proj/tests/example.spec.ts")?.includes('describe("login"'));
  assert.ok(written.get("/proj/package.json")?.includes('"test:e2e": "nativeproof"'));
});

test("scaffold updates an existing package.json without overwriting its scripts", () => {
  const written = new Map<string, string>();
  const present = new Set<string>(["/proj/package.json"]);
  const io: ScaffoldIo = {
    exists: (file) => present.has(file),
    read: () => JSON.stringify({ name: "app", scripts: { test: "vitest" } }),
    write: (file, contents) => written.set(file, contents),
  };
  const { created, skipped, updated } = scaffold("/proj", { platform: "android" }, io);
  assert.deepEqual(created, ["nativeproof.config.ts", "tests/example.spec.ts"]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(updated, ["package.json"]);
  const pkg = JSON.parse(written.get("/proj/package.json") ?? "{}") as {
    type?: string;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts?.test, "vitest");
  assert.equal(pkg.scripts?.["test:e2e"], "nativeproof");
  assert.equal(pkg.devDependencies?.nativeproof, "latest");
});

test("detectOnboardTarget accepts direct Android APK and iOS app paths", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-target-"));
  try {
    const apk = path.join(dir, "Example.apk");
    const app = path.join(dir, "Example.app");
    writeFileSync(apk, "");
    mkdirSync(app);

    assert.deepEqual(detectOnboardTarget(apk), { platform: "android", appPath: apk, sourcePath: apk });
    assert.deepEqual(detectOnboardTarget(app), { platform: "ios", appPath: app, sourcePath: app });
    assert.throws(() => detectOnboardTarget(apk, { platform: "ios" }), /\.apk conflicts with --ios/);
    assert.throws(() => detectOnboardTarget(app, { platform: "android" }), /\.app conflicts with --android/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectOnboardTarget finds built artifacts inside native app repos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-repo-"));
  try {
    const androidOutput = path.join(dir, "android", "app", "build", "outputs", "apk", "debug");
    const iosOutput = path.join(dir, "ios", "build", "Debug-iphonesimulator", "Example.app");
    mkdirSync(androidOutput, { recursive: true });
    mkdirSync(iosOutput, { recursive: true });
    const apk = path.join(androidOutput, "app-debug.apk");
    writeFileSync(apk, "");

    assert.deepEqual(detectOnboardTarget(path.join(dir, "android"), { platform: "android" }), {
      platform: "android",
      appPath: apk,
      sourcePath: path.join(dir, "android"),
    });
    assert.deepEqual(detectOnboardTarget(path.join(dir, "ios"), { platform: "ios" }), {
      platform: "ios",
      appPath: iosOutput,
      sourcePath: path.join(dir, "ios"),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectOnboardTarget explains native app repos that have no built artifact", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-empty-"));
  try {
    const androidRepo = path.join(dir, "android");
    const iosRepo = path.join(dir, "ios");
    mkdirSync(androidRepo);
    mkdirSync(iosRepo);
    writeFileSync(path.join(androidRepo, "gradlew"), "");
    mkdirSync(path.join(iosRepo, "Example.xcodeproj"));

    assert.throws(() => detectOnboardTarget(androidRepo), /Android project detected.*no built \.apk/);
    assert.throws(() => detectOnboardTarget(iosRepo), /iOS project detected.*no built \.app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard builds and stages an iOS project when no built app exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-ios-build-"));
  try {
    const iosRepo = path.join(dir, "ios", "sample-mobile-ios");
    mkdirSync(path.join(iosRepo, "Example.xcodeproj"), { recursive: true });
    const calls: Array<{ command: string; args: readonly string[]; cwd: string | undefined }> = [];
    const runCommand: NativeBuildCommandRunner = (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (args.includes("-list")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            project: {
              name: "Example",
              schemes: ["DotLottie", "Example", "Example Dev", "ExampleTests"],
            },
          }),
          stderr: "",
        };
      }

      const derivedDataPath = args[args.indexOf("-derivedDataPath") + 1];
      if (typeof derivedDataPath !== "string") {
        throw new Error("expected -derivedDataPath in xcodebuild args");
      }
      mkdirSync(path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "Example.app"), {
        recursive: true,
      });
      return { code: 65, stdout: "", stderr: "script phase failed after app build" };
    };

    const result = onboard(dir, "./ios/sample-mobile-ios", { runCommand });
    const buildCall = calls.find((call) => !call.args.includes("-list"));
    assert.ok(buildCall, "runs xcodebuild build");
    assert.equal(buildCall.command, "xcodebuild");
    assert.ok(buildCall.args.includes("-project"));
    assert.ok(buildCall.args.includes(path.join(iosRepo, "Example.xcodeproj")));
    assert.ok(buildCall.args.includes("-quiet"));
    assert.ok(buildCall.args.includes("-scheme"));
    assert.equal(buildCall.args[buildCall.args.indexOf("-scheme") + 1], "Example Dev");
    assert.ok(buildCall.args.includes("-sdk"));
    assert.equal(buildCall.args[buildCall.args.indexOf("-sdk") + 1], "iphonesimulator");
    assert.ok(buildCall.args.includes("-packageCachePath"));
    assert.ok(buildCall.args.includes("CODE_SIGNING_ALLOWED=NO"));
    assert.equal(result.target.platform, "ios");
    assert.equal(result.target.appPath, "./build/ios/Example.app");
    assert.ok(existsSync(path.join(dir, "build", "ios", "Example.app")));
    assert.match(
      readFileSync(path.join(dir, "nativeproof.config.ts"), "utf8"),
      /"appium:app": "\.\/build\/ios\/Example\.app"/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard builds an iOS project instead of reusing stale app output", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-ios-stale-"));
  try {
    const iosRepo = path.join(dir, "ios", "sample-mobile-ios");
    mkdirSync(path.join(iosRepo, "Example.xcodeproj"), { recursive: true });
    mkdirSync(path.join(iosRepo, "build", "Debug-iphonesimulator", "Old.app"), { recursive: true });

    const runCommand: NativeBuildCommandRunner = (_command, args) => {
      if (args.includes("-list")) {
        return {
          code: 0,
          stdout: JSON.stringify({ project: { name: "Example", schemes: ["Example"] } }),
          stderr: "",
        };
      }

      const derivedDataPath = args[args.indexOf("-derivedDataPath") + 1];
      if (typeof derivedDataPath !== "string") {
        throw new Error("expected -derivedDataPath in xcodebuild args");
      }
      mkdirSync(path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "New.app"), {
        recursive: true,
      });
      return { code: 0, stdout: "", stderr: "" };
    };

    const result = onboard(dir, "./ios/sample-mobile-ios", { runCommand });
    assert.equal(result.target.appPath, "./build/ios/New.app");
    assert.ok(existsSync(path.join(dir, "build", "ios", "New.app")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard rejects a stale DerivedData app when the rebuild produces nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-ios-failed-rebuild-"));
  try {
    const iosRepo = path.join(dir, "ios", "sample-mobile-ios");
    mkdirSync(path.join(iosRepo, "Example.xcodeproj"), { recursive: true });

    // A previous run left an app in the persistent DerivedData cache. utimes it into the past so it
    // predates the (about-to-fail) rebuild.
    const staleApp = path.join(
      dir,
      ".nativeproof",
      "ios",
      "DerivedData",
      "Build",
      "Products",
      "Debug-iphonesimulator",
      "Stale.app",
    );
    mkdirSync(staleApp, { recursive: true });
    const anHourAgo = Date.now() / 1000 - 3600;
    utimesSync(staleApp, anHourAgo, anHourAgo);

    // The rebuild fails and produces no new app.
    const runCommand: NativeBuildCommandRunner = (_command, args) => {
      if (args.includes("-list")) {
        return {
          code: 0,
          stdout: JSON.stringify({ project: { name: "Example", schemes: ["Example"] } }),
          stderr: "",
        };
      }
      return { code: 65, stdout: "", stderr: "build failed" };
    };

    assert.throws(
      () => onboard(dir, "./ios/sample-mobile-ios", { runCommand }),
      /iOS project build did not produce a simulator \.app.*xcodebuild exited 65/s,
    );
    // The stale app must not have been staged into the project.
    assert.equal(existsSync(path.join(dir, "build", "ios", "Stale.app")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard reports an iOS project build that produces no simulator app", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-ios-build-fail-"));
  try {
    const iosRepo = path.join(dir, "ios", "sample-mobile-ios");
    mkdirSync(path.join(iosRepo, "Example.xcodeproj"), { recursive: true });
    const runCommand: NativeBuildCommandRunner = (_command, args) => {
      if (args.includes("-list")) {
        return {
          code: 0,
          stdout: JSON.stringify({ project: { name: "Example", schemes: ["Example Dev"] } }),
          stderr: "",
        };
      }
      return { code: 65, stdout: "", stderr: "build failed before product" };
    };

    assert.throws(
      () => onboard(dir, "./ios/sample-mobile-ios", { runCommand }),
      /iOS project build did not produce a simulator \.app.*xcodebuild exited 65/s,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard scaffolds a missing project with the detected app path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-scaffold-"));
  try {
    const apk = path.join(dir, "app-debug.apk");
    writeFileSync(apk, "");
    const result = onboard(dir, apk);
    assert.equal(result.target.platform, "android");
    assert.equal(result.target.appPath, "./app-debug.apk");
    assert.deepEqual(result.created, ["nativeproof.config.ts", "tests/example.spec.ts", "package.json"]);
    assert.match(
      readFileSync(path.join(dir, "nativeproof.config.ts"), "utf8"),
      /"appium:app": "\.\/app-debug\.apk"/,
    );
    assert.match(readFileSync(path.join(dir, "package.json"), "utf8"), /"test:e2e": "nativeproof"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard updates an existing nativeproof config and package.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-update-"));
  try {
    const app = path.join(dir, "build", "ios", "Example.app");
    mkdirSync(app, { recursive: true });
    const config = scaffoldFiles({ platform: "ios" }).find((file) => file.path === "nativeproof.config.ts");
    assert.ok(config, "expected generated config");
    writeFileSync(path.join(dir, "nativeproof.config.ts"), config.contents);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }));

    const result = onboard(dir, app);
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.updated, ["nativeproof.config.ts", "package.json"]);
    const updatedConfig = readFileSync(path.join(dir, "nativeproof.config.ts"), "utf8");
    const updatedPackage = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      type?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.match(updatedConfig, /"appium:app": "\.\/build\/ios\/Example\.app"/);
    assert.doesNotMatch(updatedConfig, /"\.\/build\/ios\/MyApp\.app"/);
    assert.equal(updatedPackage.type, "module");
    assert.equal(updatedPackage.scripts?.test, "node test.js");
    assert.equal(updatedPackage.scripts?.["test:e2e"], "nativeproof");
    assert.equal(updatedPackage.devDependencies?.nativeproof, "latest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboardCommand tells users to wire the app-specific spec before running", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-onboard-next-steps-"));
  const logs: string[] = [];
  const originalLog = console.log;
  try {
    const apk = path.join(dir, "app-debug.apk");
    writeFileSync(apk, "");
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    onboardCommand(dir, apk);

    const output = logs.join("\n");
    assert.match(output, /nativeproof: onboarded android app at \.\/app-debug\.apk/);
    assert.match(output, /make tests\/example\.spec\.ts and native\.navigate\(\.\.\.\) match your app/);
    assert.match(output, /npm run test:e2e/);
  } finally {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateConfigAppPath inserts an app path when the project has capabilities but no app", () => {
  const contents = `export default defineConfig({
  projects: [
    {
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:deviceName": "iPhone 15",
      },
    },
  ],
});
`;
  const updated = updateConfigAppPath(contents, { platform: "ios", appPath: "./Example.app" });
  assert.match(updated, /"appium:app": "\.\/Example\.app"/);
  assert.match(updated, /"appium:deviceName": "iPhone 15"/);
});

test("selectIosScheme warns when it falls back to the first of several ambiguous schemes", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    assert.equal(selectIosScheme(["Alpha", "Beta"], "MyApp"), "Alpha");
    assert.match(warnings.join("\n"), /multiple Xcode schemes found; building "Alpha" \(others: Beta\)/);

    warnings.length = 0;
    assert.equal(selectIosScheme(["Alpha", "MyApp"], "MyApp"), "MyApp"); // heuristic hit — no warning
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
  }
});

test("updateConfigAppPath refuses to shadow an appium:app it cannot rewrite", () => {
  const contents = `export default defineConfig({
  projects: [
    {
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:app": appPathFromEnv,
        "appium:deviceName": "iPhone 15",
      },
    },
  ],
});
`;
  // Inserting a second "appium:app" would silently lose to the existing entry, so this must throw.
  assert.throws(
    () => updateConfigAppPath(contents, { platform: "ios", appPath: "./Example.app" }),
    /sets "appium:app" in a form onboarding cannot rewrite/,
  );
});

test("Android project onboarding failure explains how to build the missing APK", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-android-hint-"));
  try {
    writeFileSync(path.join(dir, "gradlew"), "");
    assert.throws(() => detectOnboardTarget(dir), /\.\/gradlew assembleDebug/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureAppiumDriver install failure on iOS points at the full-Xcode requirement", {
  skip: process.platform !== "darwin",
}, async () => {
  const runCommand = async (args: readonly string[]) =>
    args[1] === "list"
      ? { code: 0, stdout: JSON.stringify({}), stderr: "" }
      : { code: 1, stdout: "", stderr: "boom" };
  await assert.rejects(
    () => ensureAppiumDriver("ios", {}, runCommand),
    /full Xcode installed .*xcode-select -p/,
  );
});

test("updateConfigAppPath survives comments containing apostrophes and braces", () => {
  const contents = `export default defineConfig({
  projects: [
    {
      name: "ios",
      platform: "ios",
      // don't pin a simulator model, it's auto-selected
      /* legacy shape: { "appium:app": "./x.app" } */
      capabilities: {
        "appium:app": "./old.app",
      },
    },
    {
      name: "android",
      platform: "android",
      // Gradle's debug output lands here
      capabilities: {
        "appium:app": "./old.apk",
      },
    },
  ],
});
`;
  const updated = updateConfigAppPath(contents, { platform: "ios", appPath: "./New.app" });
  const androidAt = updated.indexOf('"android"');
  assert.match(updated.slice(0, androidAt), /"appium:app": "\.\/New\.app"/); // ios block updated
  assert.match(updated.slice(androidAt), /"appium:app": "\.\/old\.apk"/); // android untouched
  assert.doesNotMatch(updated.slice(androidAt), /New\.app/);
});

test("runSelection falls back to the env vars the runner itself reads", () => {
  const args = parseArgs([]);
  // Flags win; without them, PLATFORM/NATIVEPROOF_PROJECT steer the preflight exactly
  // like they steer the runner — previously the CLI preflighted projects[0] instead.
  assert.deepEqual(runSelection(args, { PLATFORM: "ios" }), { platform: "ios" });
  assert.deepEqual(runSelection(args, { NATIVEPROOF_PROJECT: "beta" }), { project: "beta" });
  assert.deepEqual(runSelection(parseArgs(["--android"]), { PLATFORM: "ios" }), { platform: "android" });
});

test("parseArgs recognises the inspect command and helpText documents it", () => {
  assert.equal(parseArgs(["inspect", "--android"]).command, "inspect");
  assert.match(helpText(), /nativeproof inspect\s+launch the configured app and print candidate locators/);
});
