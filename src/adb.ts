import { execFileSync } from "node:child_process";

/**
 * Thin, best-effort wrappers around `adb`.
 *
 * Android Compose occasionally hides nodes from the Appium accessibility tree
 * (Chrome custom-tab handoff, nested Compose TextViews). A raw `uiautomator dump`
 * and `input tap` give the screens a last-resort path that does not depend on the
 * Appium driver seeing the node. All calls are intentionally fault-tolerant: the
 * backend socket log — not the tap — is the proof that an action fired.
 */

export function adbArgv(args: string[], serial = process.env.ANDROID_SERIAL): string[] {
  return serial ? ["-s", serial, ...args] : args;
}

function adb(args: string[], serial?: string): string {
  return execFileSync("adb", adbArgv(args, serial), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function adbDump(serial?: string): string {
  return adb(["exec-out", "uiautomator", "dump", "/dev/tty"], serial);
}

export function adbTap(x: number, y: number, serial?: string): void {
  // Wake the screen first: on a headless/idle emulator the display sleeps and
  // `input tap` is silently dropped while asleep (this caused the Chrome
  // onboarding taps to "not register"). KEYCODE_WAKEUP is a no-op when already on.
  try {
    adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"], serial);
  } catch {
    // best-effort
  }
  adb(["shell", "input", "tap", String(x), String(y)], serial);
}

export function adbLogcatClear(serial?: string): void {
  try {
    adb(["logcat", "-c"], serial);
  } catch {
    // Runtime logcat is best-effort supporting evidence only.
  }
}

export function adbLogcatDump(serial?: string): string {
  try {
    return adb(["logcat", "-d", "-v", "time"], serial);
  } catch {
    return "";
  }
}

/**
 * Force-stop an app package (best-effort). Used to halt the real app's WebSocket
 * reconnect loop on an error status before WDIO tears the Appium session down —
 * the loop otherwise keeps the session busy and the final `deleteSession` races
 * with `UND_ERR_CLOSED`.
 */
export function adbForceStop(pkg: string, serial?: string): void {
  try {
    adb(["shell", "am", "force-stop", pkg], serial);
  } catch {
    // best-effort
  }
}

/** Browser packages are only force-stopped, never `pm clear`ed (see below). */
const BROWSER_PACKAGES = new Set(["com.android.chrome", "org.chromium.chrome", "com.chrome.beta"]);

/**
 * Reset device state before a fresh controlled-backend login.
 *
 * The app package is fully reset (force-stop + `pm clear`) so the login starts
 * from a signed-out state. Browser packages are ONLY force-stopped — never
 * `pm clear`ed — because clearing Chrome's data also wipes its first-run
 * completion, which re-triggers the Chrome 124 onboarding chain ("Turn on an ad
 * privacy feature" → "Other ad privacy features now available") and blocks the
 * OIDC Custom Tab handoff. There is nothing to gain from clearing the browser:
 * the harness mock owns the `/auth` endpoint and issues a fresh 302 redirect on
 * every request regardless of any browser cookie/session state. Complete Chrome's
 * first-run once on the emulator image and it stays done.
 *
 * Clearing a not-yet-installed package fails on some emulator images, so every
 * step is best-effort.
 */
export function resetAppAndBrowserState(packages: string[], serial?: string): void {
  for (const pkg of packages) {
    const actions = BROWSER_PACKAGES.has(pkg)
      ? [["shell", "am", "force-stop", pkg]]
      : [
          ["shell", "am", "force-stop", pkg],
          ["shell", "pm", "clear", pkg],
        ];
    for (const action of actions) {
      try {
        adb(action, serial);
      } catch {
        // best-effort
      }
    }
  }
}
