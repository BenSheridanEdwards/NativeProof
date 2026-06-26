#!/usr/bin/env node
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findConfigFile } from "./config.js";

/**
 * The `nativeproof` CLI — the single-command entry, in the spirit of `playwright test`.
 *
 * It resolves a config (an `nativeproof.config.ts`, else a raw `wdio.conf.ts`), ensures an
 * Appium server is up (starting one if needed), and runs the suite with sane env
 * (PLATFORM / SPEC / NATIVEPROOF_PROJECT / APPIUM_*) — so a consumer types one command
 * instead of remembering env vars and a runner invocation. The device/emulator itself is
 * the environment (the mobile analogue of needing a display) and is left to the host.
 */

export interface CliArgs {
  command: "test" | "init" | "help" | "version";
  config: string | undefined;
  platform: "android" | "ios" | undefined;
  project: string | undefined;
  spec: string | undefined;
  appiumHost: string;
  appiumPort: number;
  appiumPath: string;
  startAppium: boolean;
}

const DEFAULTS: CliArgs = {
  command: "test",
  config: undefined,
  platform: undefined,
  project: undefined,
  spec: undefined,
  appiumHost: "127.0.0.1",
  appiumPort: 4723,
  appiumPath: "/wd/hub",
  startAppium: true,
};

function valueFor(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
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
    if (arg === "--no-appium") {
      args.startAppium = false;
    } else if (arg === "--config") {
      i += 1;
      args.config = valueFor(argv, i, "--config");
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
      args.platform = platform;
    } else if (arg === "--appium-host") {
      i += 1;
      args.appiumHost = valueFor(argv, i, "--appium-host");
    } else if (arg === "--appium-port") {
      i += 1;
      const raw = valueFor(argv, i, "--appium-port");
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--appium-port must be an integer between 0 and 65535, got "${raw}"`);
      }
      args.appiumPort = port;
    } else if (arg === "--appium-path") {
      i += 1;
      args.appiumPath = valueFor(argv, i, "--appium-path");
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
    "nativeproof — Native Mobile E2E test framework inspired by Playwright",
    "",
    "Usage:",
    "  nativeproof [test] [options]   run the suite (default)",
    "  nativeproof init               scaffold nativeproof.config.ts + a sample spec",
    "",
    "Config is auto-discovered: nativeproof.config.ts (preferred), else wdio.conf.ts.",
    "",
    "Options:",
    "  --platform <android|ios>   platform to run (sets PLATFORM)",
    "  --project <name>           run a named project from nativeproof.config.ts",
    "  --spec <glob>              run only matching specs (sets SPEC)",
    "  --config <path>            use a raw WebdriverIO config instead of discovery",
    "  --appium-host <host>       Appium host (default: 127.0.0.1)",
    "  --appium-port <port>       Appium port (default: 4723)",
    "  --appium-path <path>       Appium base path (default: /wd/hub)",
    "  --no-appium                do not auto-start an Appium server",
    "  -h, --help                 show this help",
    "  -v, --version              print the version",
  ].join("\n");
}

const CONFIG_TEMPLATE = `import { createHarness, defineApp, defineConfig, page, startMockServer, wdioDriver } from "nativeproof";

/**
 * One file declares your app, your devices, and where your specs live — the
 * \`nativeproof\` CLI discovers it and runs the suite. Replace the TODOs with your app.
 */
const app = defineApp({
  // Acquire the device/driver (Appium/WebdriverIO under the hood).
  driver: () => wdioDriver(),
  // Start a mock backend; swap startMockServer() for your own if you have one.
  mock: () => startMockServer(),
  // Screen objects: build locators/actions from the device context. Replace these.
  screens: {
    home: ({ driver }) => ({
      heading: page(driver).getByText("Welcome"),
    }),
  },
});

// Specs import these: \`import { test, expect } from "../nativeproof.config";\`
export const { test, expect } = createHarness(app);

export default defineConfig({
  app,
  testDir: "tests",
  // platformName + automationName are filled in from \`platform\`; set \`appium:app\` to your build.
  projects: [
    { name: "android", platform: "android", capabilities: { /* "appium:app": "/path/to/app.apk" */ } },
    { name: "ios", platform: "ios", capabilities: { /* "appium:app": "/path/to/app.app" */ } },
  ],
});
`;

const SPEC_TEMPLATE = `import { expect, test } from "../nativeproof.config";

test.describe("example", () => {
  test("the home screen shows its heading", async ({ home }) => {
    await expect(home.heading).toBeVisible();
  });
});
`;

export interface ScaffoldFile {
  path: string;
  contents: string;
}

/** The starter files \`nativeproof init\` writes — pure, so they can be asserted in a test. */
export function scaffoldFiles(): ScaffoldFile[] {
  return [
    { path: "nativeproof.config.ts", contents: CONFIG_TEMPLATE },
    { path: "tests/example.spec.ts", contents: SPEC_TEMPLATE },
  ];
}

/** Minimal filesystem seam so \`scaffold\` is testable without touching disk. */
export interface ScaffoldIo {
  exists(file: string): boolean;
  write(file: string, contents: string): void;
}

const diskIo: ScaffoldIo = {
  exists: existsSync,
  write(file, contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  },
};

/** Write the starter files under \`cwd\`, never overwriting an existing one. */
export function scaffold(cwd: string, io: ScaffoldIo = diskIo): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const file of scaffoldFiles()) {
    if (io.exists(path.join(cwd, file.path))) {
      skipped.push(file.path);
      continue;
    }
    io.write(path.join(cwd, file.path), file.contents);
    created.push(file.path);
  }
  return { created, skipped };
}

export function init(cwd: string = process.cwd()): number {
  const { created, skipped } = scaffold(cwd);
  for (const file of created) console.log(`nativeproof: created ${file}`);
  for (const file of skipped) console.log(`nativeproof: ${file} already exists — skipped`);
  if (created.length === 0) {
    console.log("nativeproof: nothing to scaffold (all files already exist)");
  } else {
    console.log("\nNext: set capabilities + screens in nativeproof.config.ts, then run `nativeproof`.");
  }
  return 0;
}

function localBin(name: string): string {
  const bin = path.join(process.cwd(), "node_modules", ".bin", name);
  return existsSync(bin) ? bin : name;
}

async function appiumReachable(args: CliArgs): Promise<boolean> {
  try {
    const response = await fetch(`http://${args.appiumHost}:${args.appiumPort}${args.appiumPath}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureAppium(args: CliArgs): Promise<ChildProcess | null> {
  if (await appiumReachable(args)) return null;
  if (!args.startAppium) {
    throw new Error(
      `Appium is not reachable at http://${args.appiumHost}:${args.appiumPort}${args.appiumPath} (and --no-appium was set)`,
    );
  }
  console.log("nativeproof: starting Appium …");
  const child = spawn(localBin("appium"), ["--base-path", args.appiumPath, "--relaxed-security"], {
    stdio: "ignore",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await appiumReachable(args)) return child;
  }
  child.kill();
  throw new Error("nativeproof: Appium did not become reachable within 30s");
}

function runnerEnv(args: CliArgs): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APPIUM_HOST: args.appiumHost,
    APPIUM_PORT: String(args.appiumPort),
    APPIUM_PATH: args.appiumPath,
  };
  if (args.platform) env.PLATFORM = args.platform;
  if (args.project) env.NATIVEPROOF_PROJECT = args.project;
  if (args.spec) env.SPEC = args.spec;
  return env;
}

interface ResolvedRunner {
  wdioConfig: string;
  extraEnv: NodeJS.ProcessEnv;
}

/** Pick what to hand WebdriverIO: an explicit config, an nativeproof.config.ts, or wdio.conf.ts. */
export function resolveRunner(args: CliArgs, cwd: string = process.cwd()): ResolvedRunner {
  if (args.config) {
    const resolved = path.resolve(cwd, args.config);
    if (!existsSync(resolved)) throw new Error(`nativeproof: config not found: ${args.config}`);
    return { wdioConfig: resolved, extraEnv: {} };
  }
  const nativeproofConfig = findConfigFile(cwd);
  if (nativeproofConfig) {
    return {
      wdioConfig: fileURLToPath(new URL("./runner-config.js", import.meta.url)),
      extraEnv: {
        NATIVEPROOF_CONFIG: nativeproofConfig,
        NODE_OPTIONS: `--import tsx ${process.env.NODE_OPTIONS ?? ""}`.trim(),
      },
    };
  }
  const wdioConf = path.resolve(cwd, "wdio.conf.ts");
  if (existsSync(wdioConf)) return { wdioConfig: wdioConf, extraEnv: {} };
  throw new Error("nativeproof: no nativeproof.config.ts or wdio.conf.ts found (pass --config <path>)");
}

async function runTests(args: CliArgs): Promise<number> {
  const { wdioConfig, extraEnv } = resolveRunner(args);
  const appium = await ensureAppium(args);
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
    return init();
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
