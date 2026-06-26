import assert from "node:assert/strict";
import { test } from "node:test";
import {
  helpText,
  parseArgs,
  resolveRunner,
  type ScaffoldIo,
  scaffold,
  scaffoldFiles,
  version,
} from "../src/cli.js";

/**
 * CLI argument parsing + runner resolution — pure, no spawning. Importing the module
 * does not run `main` (it is guarded to only execute when the file is the process entry).
 */
test("parseArgs defaults to the test command with sensible defaults", () => {
  const args = parseArgs([]);
  assert.equal(args.command, "test");
  assert.equal(args.config, undefined); // discovered (nativeproof.config.ts, else wdio.conf.ts)
  assert.equal(args.project, undefined);
  assert.equal(args.appiumPort, 4723);
  assert.equal(args.appiumPath, "/wd/hub");
  assert.equal(args.startAppium, true);
  assert.equal(args.platform, undefined);
});

test("parseArgs reads platform, project, spec, config and --no-appium", () => {
  const args = parseArgs([
    "test",
    "--platform",
    "ios",
    "--project",
    "tablet",
    "--spec",
    "a.spec.ts",
    "--config",
    "x.ts",
    "--no-appium",
  ]);
  assert.equal(args.platform, "ios");
  assert.equal(args.project, "tablet");
  assert.equal(args.spec, "a.spec.ts");
  assert.equal(args.config, "x.ts");
  assert.equal(args.startAppium, false);
});

test("parseArgs surfaces --help and --version", () => {
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["-v"]).command, "version");
});

test("parseArgs rejects an invalid platform, a missing value, and unknown flags", () => {
  assert.throws(() => parseArgs(["--platform", "windows"]), /android.*ios/);
  assert.throws(() => parseArgs(["--config"]), /requires a value/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
});

test("parseArgs validates --appium-port (rejects non-numeric / out-of-range, accepts valid)", () => {
  assert.throws(() => parseArgs(["--appium-port", "abc"]), /--appium-port must be an integer/);
  assert.throws(() => parseArgs(["--appium-port", "99999"]), /--appium-port must be an integer/);
  assert.equal(parseArgs(["--appium-port", "4724"]).appiumPort, 4724);
});

test("resolveRunner errors when no config is discoverable", () => {
  assert.throws(
    () => resolveRunner(parseArgs([]), "/tmp/nativeproof-nonexistent-xyz"),
    /no nativeproof\.config/,
  );
});

test("resolveRunner errors when an explicit --config is missing", () => {
  assert.throws(
    () => resolveRunner(parseArgs(["--config", "/tmp/missing-xyz.ts"]), "/tmp"),
    /config not found/,
  );
});

test("helpText names the framework and version is semver", () => {
  assert.match(helpText(), /Native Mobile E2E test framework inspired by Playwright/);
  assert.match(version(), /^\d+\.\d+\.\d+$/);
});

test("parseArgs surfaces the init command, and help lists it", () => {
  assert.equal(parseArgs(["init"]).command, "init");
  assert.match(helpText(), /nativeproof init/);
});

test("scaffoldFiles are a well-formed config + sample spec", () => {
  const files = scaffoldFiles();
  const config = files.find((f) => f.path === "nativeproof.config.ts");
  const spec = files.find((f) => f.path === "tests/example.spec.ts");
  assert.ok(config, "writes nativeproof.config.ts");
  assert.ok(spec, "writes a sample spec");
  // The config wires the three pieces a consumer must keep: app, harness, exported config.
  assert.match(config.contents, /defineApp\(/);
  assert.match(config.contents, /createHarness\(app\)/);
  assert.match(config.contents, /export default defineConfig\(/);
  // The spec imports the harness the config exports and uses the Playwright-style facade.
  assert.match(spec.contents, /from "\.\.\/nativeproof\.config"/);
  assert.match(spec.contents, /test\.describe\(/);
});

test("scaffold writes missing files and never overwrites existing ones", () => {
  const written = new Map<string, string>();
  const present = new Set<string>(["/proj/nativeproof.config.ts"]); // config already exists
  const io: ScaffoldIo = {
    exists: (file) => present.has(file),
    write: (file, contents) => written.set(file, contents),
  };
  const { created, skipped } = scaffold("/proj", io);
  assert.deepEqual(created, ["tests/example.spec.ts"]); // only the missing one
  assert.deepEqual(skipped, ["nativeproof.config.ts"]); // existing one left intact
  assert.equal(written.has("/proj/nativeproof.config.ts"), false);
  assert.ok(written.get("/proj/tests/example.spec.ts")?.includes("test.describe("));
});
