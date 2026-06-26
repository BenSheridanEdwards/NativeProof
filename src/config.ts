import { existsSync } from "node:fs";
import path from "node:path";
import type { App, ScreenFactories } from "./app.js";
import { captureState, failureEvidenceName } from "./evidence.js";
import type { MockBackend } from "./mock.js";

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
  /** Appium capabilities for this device (e.g. `appium:app`, `appium:deviceName`). */
  capabilities: Record<string, unknown>;
}

/** The device/run config the CLI turns into a WebdriverIO run. */
export interface RunnerConfig {
  /** Directory holding the specs (default "tests"). */
  testDir?: string;
  /** Glob within `testDir` (default "**\/*.spec.ts"). */
  testMatch?: string;
  projects: DeviceProject[];
  appium?: AppiumOptions;
  /** Per-test timeout in ms (default 240000). */
  mochaTimeout?: number;
}

export interface NativeProofConfig<
  S extends ScreenFactories<M> = ScreenFactories,
  M extends MockBackend = MockBackend,
> extends RunnerConfig {
  /** The app under test (from `defineApp`). */
  app: App<S, M>;
}

/** Identity helper for typed config + editor autocomplete (mirrors Playwright's `defineConfig`). */
export function defineConfig<
  S extends ScreenFactories<M> = ScreenFactories,
  M extends MockBackend = MockBackend,
>(config: NativeProofConfig<S, M>): NativeProofConfig<S, M> {
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
 * Translate an NativeProof config into a WebdriverIO `config` object. Spec paths are made
 * absolute against `cwd` (the project root) because the synthesised config is loaded from
 * inside `node_modules`, so a relative glob would resolve against the wrong directory.
 */
export function buildWdioConfig(
  config: RunnerConfig,
  env: RunnerEnv = {},
  cwd: string = process.cwd(),
): Record<string, unknown> {
  const project = resolveProject(config, env);
  const testDir = config.testDir ?? "tests";
  const testMatch = config.testMatch ?? "**/*.spec.ts";
  const specs = [path.resolve(cwd, env.spec ?? `${testDir}/${testMatch}`)];
  return {
    runner: "local",
    hostname: env.appiumHost ?? config.appium?.host ?? "127.0.0.1",
    port: env.appiumPort ?? config.appium?.port ?? 4723,
    path: env.appiumPath ?? config.appium?.path ?? "/wd/hub",
    specs,
    maxInstances: 1,
    capabilities: [project.capabilities],
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
