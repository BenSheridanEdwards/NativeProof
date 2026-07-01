import { execFileSync } from "node:child_process";

/**
 * Thin, best-effort wrappers around `xcrun simctl` — the iOS-simulator counterpart
 * to {@link file://./adb.ts}. They control app + simulator lifecycle (terminate, launch,
 * install, uninstall, boot, shutdown, reset) so a consuming app can reset state between
 * scenarios on iOS the way `adb` does on Android.
 *
 * The device defaults to `"booted"` (the currently-booted simulator), the simctl analogue
 * of adb's single-device default. Note there is no iOS equivalent of `adbDump`: iOS exposes
 * the element tree only through the Appium (XCUITest) page source, so screens fall back to
 * that, not to an out-of-band dump.
 */

/** A command runner; injectable so the command mapping is unit-testable without a simulator. */
export type SimctlRunner = (args: string[]) => string;

const realRunner: SimctlRunner = (args) =>
  execFileSync("xcrun", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Build the argv for an `xcrun simctl <action> <udid> [...]` invocation (pure). */
export function simctlArgv(action: string, udid: string, ...rest: string[]): string[] {
  return ["simctl", action, udid, ...rest];
}

/** Stop a running app (best-effort) — the iOS analogue of `adbForceStop`. */
export function iosTerminate(bundleId: string, udid = "booted", run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("terminate", udid, bundleId));
  } catch {
    /* best-effort */
  }
}

/** Launch an installed app (best-effort). */
export function iosLaunch(bundleId: string, udid = "booted", run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("launch", udid, bundleId));
  } catch {
    /* best-effort */
  }
}

/** Install a `.app`/`.ipa` build (best-effort). */
export function iosInstall(appPath: string, udid = "booted", run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("install", udid, appPath));
  } catch {
    /* best-effort */
  }
}

/** Uninstall an app, clearing its data + sandbox (best-effort). */
export function iosUninstall(bundleId: string, udid = "booted", run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("uninstall", udid, bundleId));
  } catch {
    /* best-effort */
  }
}

/** Boot a simulator by udid (best-effort; no-op if already booted). */
export function iosBoot(udid: string, run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("boot", udid));
  } catch {
    /* best-effort */
  }
}

/** Shut a simulator down (best-effort). */
export function iosShutdown(udid = "booted", run: SimctlRunner = realRunner): void {
  try {
    run(simctlArgv("shutdown", udid));
  } catch {
    /* best-effort */
  }
}

/**
 * Reset an app to a clean state before a fresh login — the iOS analogue of
 * `resetAppAndBrowserState`. Terminates then uninstalls the app (which clears its data and
 * sandbox); reinstalls from `appPath` when given so the next launch starts signed-out.
 */
export function resetAppState(
  bundleId: string,
  options: { udid?: string; appPath?: string; run?: SimctlRunner } = {},
): void {
  const udid = options.udid ?? "booted";
  const run = options.run ?? realRunner;
  const steps: string[][] = [
    simctlArgv("terminate", udid, bundleId),
    simctlArgv("uninstall", udid, bundleId),
  ];
  if (options.appPath) steps.push(simctlArgv("install", udid, options.appPath));
  for (const step of steps) {
    try {
      run(step);
    } catch {
      /* best-effort */
    }
  }
}

/** Recent simulator logs (best-effort supporting evidence) — the analogue of `adbLogcatDump`. */
export function iosLogShow(udid = "booted", since = "1m", run: SimctlRunner = realRunner): string {
  try {
    return run(simctlArgv("spawn", udid, "log", "show", "--style", "compact", "--last", since));
  } catch {
    return "";
  }
}
