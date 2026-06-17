import assert from "node:assert/strict";
import { test } from "node:test";
import { helpText, parseArgs, resolveRunner, version } from "../src/cli.js";

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
