import assert from "node:assert/strict";
import { test } from "node:test";
import {
  iosInstall,
  iosLaunch,
  iosShutdown,
  iosTerminate,
  iosUninstall,
  resetAppState,
  simctlArgv,
} from "../src/ios.js";

/**
 * The iOS (simctl) command mapping, verified via an injected runner — no simulator.
 */
test("simctlArgv builds an `xcrun simctl <action> <udid> [...]` argv", () => {
  assert.deepEqual(simctlArgv("terminate", "booted", "com.app"), [
    "simctl",
    "terminate",
    "booted",
    "com.app",
  ]);
  assert.deepEqual(simctlArgv("boot", "ABC-123"), ["simctl", "boot", "ABC-123"]);
});

test("the iOS commands invoke simctl with the right action and argument order", () => {
  const calls: string[][] = [];
  const run = (args: string[]): string => {
    calls.push(args);
    return "";
  };
  iosTerminate("com.app", "booted", run);
  iosLaunch("com.app", "booted", run);
  iosInstall("/tmp/App.app", "booted", run);
  iosUninstall("com.app", "booted", run);
  iosShutdown("booted", run);
  assert.deepEqual(calls, [
    ["simctl", "terminate", "booted", "com.app"],
    ["simctl", "launch", "booted", "com.app"],
    ["simctl", "install", "booted", "/tmp/App.app"],
    ["simctl", "uninstall", "booted", "com.app"],
    ["simctl", "shutdown", "booted"],
  ]);
});

test("resetAppState terminates + uninstalls, and reinstalls when an app path is given", () => {
  const calls: string[][] = [];
  const run = (args: string[]): string => {
    calls.push(args);
    return "";
  };
  resetAppState("com.app", { run });
  assert.deepEqual(calls, [
    ["simctl", "terminate", "booted", "com.app"],
    ["simctl", "uninstall", "booted", "com.app"],
  ]);

  calls.length = 0;
  resetAppState("com.app", { udid: "X", appPath: "/A.app", run });
  assert.deepEqual(calls, [
    ["simctl", "terminate", "X", "com.app"],
    ["simctl", "uninstall", "X", "com.app"],
    ["simctl", "install", "X", "/A.app"],
  ]);
});
