import assert from "node:assert/strict";
import { test } from "node:test";
import { adbArgv } from "../src/adb.js";

test("adbArgv targets the selected Android serial when one is provided", () => {
  assert.deepEqual(adbArgv(["shell", "input", "tap", "1", "2"], "emulator-5556"), [
    "-s",
    "emulator-5556",
    "shell",
    "input",
    "tap",
    "1",
    "2",
  ]);
  assert.deepEqual(adbArgv(["logcat", "-d"]), ["logcat", "-d"]);
});

test("adbArgv falls back to ANDROID_SERIAL for runner-plumbed helpers", () => {
  const previous = process.env.ANDROID_SERIAL;
  try {
    process.env.ANDROID_SERIAL = "device-123";
    assert.deepEqual(adbArgv(["exec-out", "uiautomator", "dump", "/dev/tty"]), [
      "-s",
      "device-123",
      "exec-out",
      "uiautomator",
      "dump",
      "/dev/tty",
    ]);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_SERIAL;
    else process.env.ANDROID_SERIAL = previous;
  }
});
