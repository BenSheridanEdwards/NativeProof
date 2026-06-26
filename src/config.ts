import { existsSync } from "node:fs";
import path from "node:path";
import type { App } from "./app.js";
import { captureState, failureEvidenceName } from "./evidence.js";

/**
 * The Playwright-style config: one `nativeproof.config.ts` declares the app, the device
 * projects, and where the tests live. The `nativeproof` CLI auto-discovers it and
 * synthesises the WebdriverIO run from it — so no hand-written `wdio.conf.ts`.
 *
 * ```ts
 * // nativeproof.config.ts
 * const app = defineApp({ ... });
 * export const { test, expect } = createHarness(app);   // specs import these
 * export default defineConfig({
 *   app,
 *   testDir: "tests",
 *   projects: [
 *     { name: "android", platform: "android", capabilities: { ... } },
 *     { name: "ios", platform: "ios", capabilities: { ... } },
 *   ],
 * });
 * ```
 */

/** Appium connection settings (defaults: 127.0.0.1 : 4723 /wd/hub). */
export interface AppiumOptions {
  host?: string;
  port?: number;
  path?: string;
}

/** One device target — the NativeProof analogue of a Playwright project. */
export interface DeviceProject {
  /** A name to select with `nativeproof --project <name>`. */
  name: string;
  platform: "android" | "ios";
  /**
   * Appium capabilities for this device (e.g. `appium:app`, `appium:deviceName`). Optional:
   * `platformName` and `appium:automationName` are filled in from `platform` (see
   * {@link defaultCapabilities}), so a project usually needs only `appium:app` — or nothing
   * for a smoke run against whatever is already installed. Anything you set here wins.
   */
  capabilities?: Record<string, unknown>;
  /**
   * Spec globs for THIS project, relative to the project root — overriding the top-level
   * `testDir`/`testMatch` when set. For suites where platforms run different specs (e.g. a shared
   * set plus a platform-specific set: `["e2e/shared/**\/*.spec.ts", "e2e/android/**\/*.spec.ts"]`).
   * A `--spec` CLI override still wins over this.
   */
  specs?: string[];
}

/**
 * The standard capabilities for a platform, so a consumer doesn't restate the same
 * `platformName` / `automationName` in every project. Android → UiAutomator2, iOS → XCUITest
 * (the canonical Appium drivers). A project's own `capabilities` override these.
 */
export function defaultCapabilities(platform: "android" | "ios"): Record<string, unknown> {
  return platform === "android"
    ? { platformName: "Android", "appium:automationName": "UiAutomator2" }
    : { platformName: "iOS", "appium:automationName": "XCUITest" };
}

/** The device/run config the CLI turns into a WebdriverIO run. */
export interface RunnerConfig {
  /** Directory holding the specs (default "tests"). */
  testDir?: string;
  /** Glob within `testDir` (default "**\/*.spec.ts"). A project's own `specs` overrides this. */
  testMatch?: string;
  projects: DeviceProject[];
  appium?: AppiumOptions;
  /** Per-test timeout in ms (default 240000). */
  mochaTimeout?: number;
  /**
   * WebdriverIO pass-throughs for tuning real-device runs. Each is forwarded only when set, so
   * WebdriverIO's own defaults apply otherwise. Slow software-GPU emulators in particular often
   * need a longer `connectionRetryTimeout` / `waitforTimeout` than the defaults.
   */
  /** Per-command/session connection timeout in ms (wdio default 120000). */
  connectionRetryTimeout?: number;
  /** Connection retry count (wdio default 3). */
  connectionRetryCount?: number;
  /** Default auto-wait timeout in ms for `waitUntil`/`waitFor*` (wdio default 5000). */
  waitforTimeout?: number;
  /** Stop the run after N failures; 0 = never bail (wdio default 0). */
  bail?: number;
  /** WebdriverIO log level (wdio default "info"). */
  logLevel?: "trace" | "debug" | "info" | "warn" | "error" | "silent";
}

export interface NativeProofConfig<Ctx = unknown> extends RunnerConfig {
  /** The app under test (from `defineApp`). */
  app: App<Ctx>;
}

/** Identity helper for typed config + editor autocomplete (mirrors Playwright's `defineConfig`). */
export function defineConfig<Ctx>(config: NativeProofConfig<Ctx>): NativeProofConfig<Ctx> {
  return config;
}

/** Selection inputs (from the CLI / env) used to resolve the active project + connection. */
export interface RunnerEnv {
  platform?: string;
  project?: string;
  spec?: string;
  appiumHost?: string;
  appiumPort?: number;
  appiumPath?: string;
}

/** Pick the project by explicit name, else by platform, else the first one. */
export function resolveProject(config: RunnerConfig, env: RunnerEnv = {}): DeviceProject {
  if (env.project) {
    const named = config.projects.find((project) => project.name === env.project);
    if (!named) throw new Error(`nativeproof: no project named "${env.project}"`);
    return named;
  }
  if (env.platform) {
    const byPlatform = config.projects.find((project) => project.platform === env.platform);
    if (byPlatform) return byPlatform;
  }
  const first = config.projects[0];
  if (!first) throw new Error("nativeproof: config has no `projects`");
  return first;
}

/**
 * Resolve the spec globs (absolute) for a run, in precedence order: an explicit `--spec` override
 * (comma-separated allowed), else the active project's own `specs`, else the top-level
 * `testDir`/`testMatch`. Absolute against `cwd` because the synthesised config is loaded from inside
 * `node_modules`, so a relative glob would resolve against the wrong directory.
 */
function resolveSpecs(config: RunnerConfig, project: DeviceProject, env: RunnerEnv, cwd: string): string[] {
  const abs = (glob: string): string => path.resolve(cwd, glob);
  if (env.spec) return env.spec.split(",").map((glob) => abs(glob.trim()));
  if (project.specs && project.specs.length > 0) return project.specs.map(abs);
  const testDir = config.testDir ?? "tests";
  const testMatch = config.testMatch ?? "**/*.spec.ts";
  return [abs(`${testDir}/${testMatch}`)];
}

/**
 * Translate an NativeProof config into a WebdriverIO `config` object.
 */
export function buildWdioConfig(
  config: RunnerConfig,
  env: RunnerEnv = {},
  cwd: string = process.cwd(),
): Record<string, unknown> {
  const project = resolveProject(config, env);
  const wdio: Record<string, unknown> = {
    runner: "local",
    hostname: env.appiumHost ?? config.appium?.host ?? "127.0.0.1",
    port: env.appiumPort ?? config.appium?.port ?? 4723,
    path: env.appiumPath ?? config.appium?.path ?? "/wd/hub",
    specs: resolveSpecs(config, project, env, cwd),
    maxInstances: 1,
    capabilities: [{ ...defaultCapabilities(project.platform), ...project.capabilities }],
    framework: "mocha",
    reporters: ["spec"],
    mochaOpts: { ui: "bdd", timeout: config.mochaTimeout ?? 240_000 },
    // Evidence on failure, out of the box: on a failed behaviour, snapshot a screenshot +
    // redacted page source into the artifact dir, named after the spec. Best-effort — a
    // capture error never masks the real failure — and consumers get it without writing
    // their own afterTest hook.
    afterTest: async (
      test: { title: string; parent: string },
      _context: unknown,
      result: { passed: boolean },
    ): Promise<void> => {
      if (result.passed) return;
      await captureState(failureEvidenceName(test)).catch(() => {});
    },
  };
  // Optional WebdriverIO tuning — forwarded only when the consumer set it, so wdio's defaults apply
  // otherwise (real emulators/simulators often need longer connection/wait timeouts than the defaults).
  if (config.connectionRetryTimeout !== undefined)
    wdio.connectionRetryTimeout = config.connectionRetryTimeout;
  if (config.connectionRetryCount !== undefined) wdio.connectionRetryCount = config.connectionRetryCount;
  if (config.waitforTimeout !== undefined) wdio.waitforTimeout = config.waitforTimeout;
  if (config.bail !== undefined) wdio.bail = config.bail;
  if (config.logLevel !== undefined) wdio.logLevel = config.logLevel;
  return wdio;
}

const CONFIG_NAMES = [
  "nativeproof.config.ts",
  "nativeproof.config.mts",
  "nativeproof.config.cts",
  "nativeproof.config.js",
  "nativeproof.config.mjs",
  "nativeproof.config.cjs",
];

/** Find an `nativeproof.config.*` in `dir`, or null. `exists` is injectable for testing. */
export function findConfigFile(dir: string, exists: (file: string) => boolean = existsSync): string | null {
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}
