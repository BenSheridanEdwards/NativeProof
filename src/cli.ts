#!/usr/bin/env node
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type AppiumOptions, findConfigFile, type NativeProofConfig } from "./config.js";

/**
 * The `nativeproof` CLI — the single-command entry, in the spirit of `playwright test`.
 *
 * It resolves `nativeproof.config.ts`, ensures the configured Appium server is up (starting one
 * if needed), and runs the suite with sane env (PLATFORM / SPEC / NATIVEPROOF_PROJECT) — so a
 * consumer types one command instead of remembering env vars and a runner invocation. The
 * device/emulator itself is the environment (the mobile analogue of needing a display) and is left
 * to the host.
 */

export interface CliArgs {
  command: "test" | "init" | "help" | "version";
  platform: "android" | "ios" | undefined;
  initPlatform: "android" | "ios" | undefined;
  project: string | undefined;
  spec: string | undefined;
  startAppium: boolean;
}

const DEFAULTS: CliArgs = {
  command: "test",
  platform: undefined,
  initPlatform: undefined,
  project: undefined,
  spec: undefined,
  startAppium: true,
};

function valueFor(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

function setPlatform(args: CliArgs, platform: "android" | "ios", source: string): void {
  if (args.platform && args.platform !== platform) {
    throw new Error(`${source} conflicts with --platform ${args.platform}`);
  }
  if (args.initPlatform && args.initPlatform !== platform) {
    throw new Error(`${source} conflicts with --${args.initPlatform}`);
  }
  args.platform = platform;
  args.initPlatform = platform;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "test") continue;
    if (arg === "init") {
      args.command = "init";
      continue;
    }
    if (arg === "-h" || arg === "--help") return { ...args, command: "help" };
    if (arg === "-v" || arg === "--version") return { ...args, command: "version" };
    if (arg === "--ios") {
      setPlatform(args, "ios", "--ios");
    } else if (arg === "--android") {
      setPlatform(args, "android", "--android");
    } else if (arg === "--no-appium") {
      args.startAppium = false;
    } else if (arg === "--project") {
      i += 1;
      args.project = valueFor(argv, i, "--project");
    } else if (arg === "--spec") {
      i += 1;
      args.spec = valueFor(argv, i, "--spec");
    } else if (arg === "--platform") {
      i += 1;
      const platform = valueFor(argv, i, "--platform");
      if (platform !== "android" && platform !== "ios") {
        throw new Error('--platform must be "android" or "ios"');
      }
      setPlatform(args, platform, "--platform");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function version(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function helpText(): string {
  return [
    "nativeproof — Playwright-feeling native mobile E2E for Appium/WebdriverIO",
    "",
    "Usage:",
    "  nativeproof [test] [options]   run the suite (default)",
    "  nativeproof init --ios         scaffold nativeproof.config.ts + a sample spec for iOS",
    "  nativeproof init --android     scaffold nativeproof.config.ts + a sample spec for Android",
    "",
    "Config is auto-discovered from nativeproof.config.ts.",
    "",
    "Options:",
    "  --ios                      shorthand for --platform ios",
    "  --android                  shorthand for --platform android",
    "  --platform <android|ios>   platform to run (sets PLATFORM)",
    "  --project <name>           run a named project from nativeproof.config.ts",
    "  --spec <glob>              run only matching specs (sets SPEC)",
    "  --no-appium                do not auto-start an Appium server",
    "  -h, --help                 show this help",
    "  -v, --version              print the version",
  ].join("\n");
}

type InitPlatform = "android" | "ios";

export interface ScaffoldOptions {
  platform: InitPlatform;
}

function projectTemplate(platform: InitPlatform): string {
  if (platform === "android") {
    return `    {
      name: "android",
      platform: "android",
      capabilities: {
        "appium:app": "./app/build/outputs/apk/debug/app-debug.apk",
        "appium:deviceName": "Android Emulator",
      },
    }`;
  }
  return `    {
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:app": "./build/ios/MyApp.app",
        "appium:deviceName": "iPhone 15",
      },
    }`;
}

function configTemplate(options: ScaffoldOptions): string {
  const projects = projectTemplate(options.platform);
  return `import { createNative, defineConfig, expect, wdioDriver } from "nativeproof";

const driver = () => wdioDriver();

export const native = createNative({
  driver,
  async navigate(route) {
    // Keep app-specific routing here: deep links, reset flows, mock-backend state, etc.
    if (route !== "/login") {
      throw new Error(\`Configure native.navigate(\${JSON.stringify(route)}) in nativeproof.config.ts\`);
    }
  },
});

export { expect };

export default defineConfig({
  testDir: "tests",
  artifacts: { dir: ".e2e-artifacts" },
  mochaTimeout: 240_000,
  projects: [
${projects},
  ],
});
`;
}

const SPEC_TEMPLATE = `import { expect, native } from "../nativeproof.config";

describe("login", () => {
  it("should be able to log in", async () => {
    await native.navigate("/login");
    await native.tap("Log in");

    await expect(native.getByText("Welcome back")).toBeVisible();
  });
});
`;

function packageTemplate(): string {
  return `${JSON.stringify(
    {
      private: true,
      scripts: {
        "test:e2e": "nativeproof",
      },
      devDependencies: {
        nativeproof: "latest",
      },
    },
    null,
    2,
  )}\n`;
}

function packageCommand(): string {
  return "nativeproof";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensurePackageJson(raw: string): { contents: string; changed: boolean } {
  const pkg = JSON.parse(raw) as unknown;
  if (!isRecord(pkg)) {
    throw new Error("nativeproof: package.json must contain a JSON object");
  }

  let changed = false;
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  if (!isRecord(pkg.scripts)) {
    pkg.scripts = scripts;
    changed = true;
  }
  if (typeof scripts["test:e2e"] !== "string") {
    scripts["test:e2e"] = packageCommand();
    changed = true;
  }

  const dependencies = isRecord(pkg.dependencies) ? pkg.dependencies : {};
  const devDependencies = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const alreadyDependsOnNativeProof =
    typeof dependencies.nativeproof === "string" || typeof devDependencies.nativeproof === "string";
  if (!isRecord(pkg.devDependencies)) {
    pkg.devDependencies = devDependencies;
    changed = true;
  }
  if (!alreadyDependsOnNativeProof) {
    devDependencies.nativeproof = "latest";
    changed = true;
  }

  return { contents: `${JSON.stringify(pkg, null, 2)}\n`, changed };
}

export interface ScaffoldFile {
  path: string;
  contents: string;
}

/** The starter files \`nativeproof init\` writes — pure, so they can be asserted in a test. */
export function scaffoldFiles(options: ScaffoldOptions): ScaffoldFile[] {
  return [
    { path: "nativeproof.config.ts", contents: configTemplate(options) },
    { path: "tests/example.spec.ts", contents: SPEC_TEMPLATE },
    { path: "package.json", contents: packageTemplate() },
  ];
}

/** Minimal filesystem seam so \`scaffold\` is testable without touching disk. */
export interface ScaffoldIo {
  exists(file: string): boolean;
  read(file: string): string;
  write(file: string, contents: string): void;
}

const diskIo: ScaffoldIo = {
  exists: existsSync,
  read: (file) => readFileSync(file, "utf8"),
  write(file, contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  },
};

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  updated: string[];
}

/** Write the starter files under \`cwd\`, never overwriting an existing one. */
export function scaffold(cwd: string, options: ScaffoldOptions, io: ScaffoldIo = diskIo): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const updated: string[] = [];
  for (const file of scaffoldFiles(options)) {
    const target = path.join(cwd, file.path);
    if (io.exists(target)) {
      if (file.path === "package.json") {
        const merged = ensurePackageJson(io.read(target));
        if (merged.changed) {
          io.write(target, merged.contents);
          updated.push(file.path);
        } else {
          skipped.push(file.path);
        }
        continue;
      }
      skipped.push(file.path);
      continue;
    }
    io.write(target, file.contents);
    created.push(file.path);
  }
  return { created, skipped, updated };
}

export function init(cwd: string = process.cwd(), options: ScaffoldOptions): number {
  const { created, skipped, updated } = scaffold(cwd, options);
  for (const file of created) console.log(`nativeproof: created ${file}`);
  for (const file of updated) console.log(`nativeproof: updated ${file}`);
  for (const file of skipped) console.log(`nativeproof: ${file} already exists — skipped`);
  if (created.length === 0 && updated.length === 0) {
    console.log("nativeproof: nothing to scaffold (all files already exist)");
  } else {
    console.log(
      `\nNext: set the app path + native.navigate(...) in nativeproof.config.ts, then run \`npm run test:e2e\`.`,
    );
  }
  return 0;
}

function localBin(name: string): string {
  const bin = path.join(process.cwd(), "node_modules", ".bin", name);
  return existsSync(bin) ? bin : name;
}

function appiumEndpoint(options: AppiumOptions = {}): Required<AppiumOptions> {
  return {
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 4723,
    path: options.path ?? "/wd/hub",
  };
}

async function appiumReachable(options: AppiumOptions = {}): Promise<boolean> {
  const endpoint = appiumEndpoint(options);
  try {
    const response = await fetch(`http://${endpoint.host}:${endpoint.port}${endpoint.path}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureAppium(
  appium: AppiumOptions | undefined,
  startAppium: boolean,
): Promise<ChildProcess | null> {
  const endpoint = appiumEndpoint(appium);
  if (await appiumReachable(endpoint)) return null;
  if (!startAppium) {
    throw new Error(
      `Appium is not reachable at http://${endpoint.host}:${endpoint.port}${endpoint.path} (and --no-appium was set)`,
    );
  }
  console.log("nativeproof: starting Appium …");
  const child = spawn(
    localBin("appium"),
    [
      "--address",
      endpoint.host,
      "--port",
      String(endpoint.port),
      "--base-path",
      endpoint.path,
      "--relaxed-security",
    ],
    {
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await appiumReachable(endpoint)) return child;
  }
  child.kill();
  throw new Error("nativeproof: Appium did not become reachable within 30s");
}

function runnerEnv(args: CliArgs): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  if (args.platform) env.PLATFORM = args.platform;
  if (args.project) env.NATIVEPROOF_PROJECT = args.project;
  if (args.spec) env.SPEC = args.spec;
  return env;
}

interface ResolvedRunner {
  wdioConfig: string;
  configPath: string;
  extraEnv: NodeJS.ProcessEnv;
}

/** Pick what to hand WebdriverIO: the discovered nativeproof.config.ts. */
export function resolveRunner(_args: CliArgs, cwd: string = process.cwd()): ResolvedRunner {
  const nativeproofConfig = findConfigFile(cwd);
  if (nativeproofConfig) {
    return {
      wdioConfig: fileURLToPath(new URL("./runner-config.js", import.meta.url)),
      configPath: nativeproofConfig,
      extraEnv: {
        NATIVEPROOF_CONFIG: nativeproofConfig,
        NODE_OPTIONS: `--import tsx ${process.env.NODE_OPTIONS ?? ""}`.trim(),
      },
    };
  }
  throw new Error(
    "nativeproof: no nativeproof.config.ts found (run `nativeproof init --ios` or `nativeproof init --android`)",
  );
}

export async function loadNativeProofConfig(configPath: string): Promise<NativeProofConfig> {
  const { tsImport } = await import("tsx/esm/api");
  const loaded = await tsImport(pathToFileURL(configPath).href, import.meta.url);
  const config = nativeProofConfigFromModule(loaded);
  if (!config) {
    throw new Error(`${configPath} must \`export default defineConfig(...)\``);
  }
  return config;
}

function isNativeProofConfig(value: unknown): value is NativeProofConfig {
  return typeof value === "object" && value !== null && Array.isArray((value as NativeProofConfig).projects);
}

function nativeProofConfigFromModule(loaded: unknown): NativeProofConfig | undefined {
  let current: unknown = loaded;
  for (let depth = 0; depth < 3; depth += 1) {
    if (isNativeProofConfig(current)) return current;
    if (typeof current !== "object" || current === null || !("default" in current)) return undefined;
    current = (current as { default?: unknown }).default;
  }
  return isNativeProofConfig(current) ? current : undefined;
}

async function runTests(args: CliArgs): Promise<number> {
  const { wdioConfig, configPath, extraEnv } = resolveRunner(args);
  const userConfig = await loadNativeProofConfig(configPath);
  const appium = await ensureAppium(userConfig.appium, args.startAppium);
  try {
    return await new Promise<number>((resolve, reject) => {
      const runner = spawn(localBin("wdio"), ["run", wdioConfig], {
        stdio: "inherit",
        env: { ...runnerEnv(args), ...extraEnv },
      });
      runner.on("error", reject);
      runner.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    appium?.kill();
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "help") {
    console.log(helpText());
    return 0;
  }
  if (args.command === "version") {
    console.log(version());
    return 0;
  }
  if (args.command === "init") {
    if (!args.initPlatform) {
      throw new Error("nativeproof init requires --ios or --android");
    }
    return init(process.cwd(), { platform: args.initPlatform });
  }
  return runTests(args);
}

/** True when this file is the process entry — robust to the symlink npm creates for bins. */
function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
