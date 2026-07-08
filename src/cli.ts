#!/usr/bin/env node
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AppiumOptions,
  findConfigFile,
  type NativeProofConfig,
  projectCapabilities,
  type RunnerEnv,
  resolveProject,
} from "./config.js";
import { selectorSuggestions } from "./inspect.js";

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
  command: "test" | "init" | "onboard" | "inspect" | "help" | "version";
  platform: "android" | "ios" | undefined;
  initPlatform: "android" | "ios" | undefined;
  onboardPath: string | undefined;
  project: string | undefined;
  spec: string | undefined;
  startAppium: boolean;
}

const DEFAULTS: CliArgs = {
  command: "test",
  platform: undefined,
  initPlatform: undefined,
  onboardPath: undefined,
  project: undefined,
  spec: undefined,
  startAppium: true,
};

type DefaultCommand = "test" | "init" | "onboard";

export function defaultCommandForProgram(programName: string | undefined): DefaultCommand {
  const name = path.basename(programName ?? "");
  if (name.startsWith("nativeproof-onboard")) return "onboard";
  return name.startsWith("nativeproof-init") ? "init" : "test";
}

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

export function parseArgs(
  argv: readonly string[],
  options: { defaultCommand?: DefaultCommand } = {},
): CliArgs {
  const args: CliArgs = { ...DEFAULTS, command: options.defaultCommand ?? DEFAULTS.command };
  // A command keyword is only the command in leading position. Once one is chosen, a later bare
  // word is a positional for that command — otherwise `nativeproof onboard test` reads `test` as a
  // command and silently launches a device run instead of onboarding a path named `test`.
  let commandChosen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!commandChosen && (arg === "test" || arg === "init" || arg === "onboard" || arg === "inspect")) {
      args.command = arg;
      commandChosen = true;
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
    } else if (args.command === "onboard" && !arg.startsWith("-") && !args.onboardPath) {
      args.onboardPath = arg;
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
    "  nativeproof onboard <path>     point nativeproof.config.ts at an app artifact or iOS project",
    "  nativeproof inspect            launch the configured app and print candidate locators",
    "  nativeproof-init --ios         same init shortcut, useful from package-manager bins",
    "  nativeproof-init --android     same init shortcut for Android",
    "  nativeproof-onboard <path>     onboard shortcut, useful from package-manager bins",
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
  appPath?: string | undefined;
}

function defaultAppPath(platform: InitPlatform): string {
  return platform === "android" ? "./app/build/outputs/apk/debug/app-debug.apk" : "./build/ios/MyApp.app";
}

function projectTemplate(options: ScaffoldOptions): string {
  const appPath = options.appPath ?? defaultAppPath(options.platform);
  const appPathLiteral = JSON.stringify(appPath);
  if (options.platform === "android") {
    return `    {
      name: "android",
      platform: "android",
      capabilities: {
        "appium:app": ${appPathLiteral},
        "appium:deviceName": "Android Emulator",
      },
    }`;
  }
  return `    {
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:app": ${appPathLiteral},
      },
    }`;
}

function configTemplate(options: ScaffoldOptions): string {
  const projects = projectTemplate(options);
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
  appium: {
    autoInstallDrivers: true,
    autoSelectBootedSimulator: true,
  },
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
      type: "module",
      scripts: {
        "test:e2e": "nativeproof",
      },
      devDependencies: {
        nativeproof: nativeproofVersionRange(),
      },
    },
    null,
    2,
  )}\n`;
}

function nativeproofVersionRange(): string {
  return `^${version()}`;
}

function tsconfigTemplate(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node", "mocha", "@wdio/globals/types"],
      },
      include: ["nativeproof.config.ts", "tests/**/*.ts"],
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
  if (typeof pkg.type !== "string") {
    pkg.type = "module";
    changed = true;
  }

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
    devDependencies.nativeproof = nativeproofVersionRange();
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
    { path: "tsconfig.json", contents: tsconfigTemplate() },
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

interface CandidateArtifact {
  path: string;
  platform: InitPlatform;
  mtimeMs: number;
}

export interface OnboardTarget {
  platform: InitPlatform;
  appPath: string;
  sourcePath: string;
}

export interface OnboardResult {
  target: OnboardTarget;
  created: string[];
  skipped: string[];
  updated: string[];
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function candidate(platform: InitPlatform, artifactPath: string): CandidateArtifact {
  return { path: artifactPath, platform, mtimeMs: statSync(artifactPath).mtimeMs };
}

function shouldSkipDiscoveryDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === "Pods" || name === "DerivedData";
}

function discoverBuiltArtifacts(root: string, platform: InitPlatform | undefined): CandidateArtifact[] {
  const candidates: CandidateArtifact[] = [];
  const pending: string[] = [root];
  let visited = 0;
  while (pending.length > 0 && visited < 8000) {
    const dir = pending.pop();
    if (!dir) continue;
    visited += 1;

    // A single unreadable directory (permissions, a race with a build cleaning up) must not abort
    // the whole walk and lose every other artifact — skip it and keep scanning.
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkipDiscoveryDirectory(entry.name)) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".app")) {
          if (!platform || platform === "ios") candidates.push(candidate("ios", entryPath));
          continue;
        }
        pending.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".apk") && (!platform || platform === "android")) {
        candidates.push(candidate("android", entryPath));
      }
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function hasAndroidProjectMarker(root: string): boolean {
  return existsSync(path.join(root, "gradlew")) || existsSync(path.join(root, "settings.gradle"));
}

function hasIosProjectMarker(root: string): boolean {
  return readdirSync(root, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() && (entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcworkspace")),
  );
}

export interface NativeBuildCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface NativeBuildCommandOptions {
  cwd?: string | undefined;
  stdio?: "pipe" | "inherit" | undefined;
}

export type NativeBuildCommandRunner = (
  command: string,
  args: readonly string[],
  options?: NativeBuildCommandOptions,
) => NativeBuildCommandResult;

function outputToString(output: string | Buffer | null | undefined): string {
  if (typeof output === "string") return output;
  return output ? output.toString("utf8") : "";
}

const runNativeBuildCommand: NativeBuildCommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status ?? (result.error ? 1 : 0),
    stdout: outputToString(result.stdout),
    stderr: [outputToString(result.stderr), result.error?.message ?? ""].filter(Boolean).join("\n"),
  };
};

interface IosProjectDescriptor {
  kind: "project" | "workspace";
  path: string;
  name: string;
}

interface IosBuildPlan {
  descriptor: IosProjectDescriptor;
  scheme: string;
}

function stripXcodeExtension(name: string): string {
  return name.replace(/\.(?:xcodeproj|xcworkspace)$/i, "");
}

function findIosProjectDescriptors(root: string): IosProjectDescriptor[] {
  const workspaces: IosProjectDescriptor[] = [];
  const projects: IosProjectDescriptor[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith(".xcworkspace") && entry.name !== "Pods.xcworkspace") {
      workspaces.push({
        kind: "workspace",
        path: path.join(root, entry.name),
        name: stripXcodeExtension(entry.name),
      });
    }
    if (entry.name.endsWith(".xcodeproj")) {
      projects.push({
        kind: "project",
        path: path.join(root, entry.name),
        name: stripXcodeExtension(entry.name),
      });
    }
  }
  return [...workspaces, ...projects];
}

function xcodebuildContainerArgs(descriptor: IosProjectDescriptor): string[] {
  return descriptor.kind === "workspace" ? ["-workspace", descriptor.path] : ["-project", descriptor.path];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function schemesFromXcodebuildList(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) return [];
  const container = isRecord(parsed.project)
    ? parsed.project
    : isRecord(parsed.workspace)
      ? parsed.workspace
      : {};
  return stringArray(container.schemes);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTestScheme(scheme: string): boolean {
  return /(?:tests?|uitests)$/i.test(scheme.replace(/\s+/g, ""));
}

export function selectIosScheme(schemes: readonly string[], projectName: string): string {
  const appSchemes = schemes.filter((scheme) => !isTestScheme(scheme));
  const candidates = appSchemes.length > 0 ? appSchemes : schemes;
  const projectPattern = new RegExp(escapeRegExp(projectName), "i");
  const devPattern = /\bdev(?:elopment)?\b/i;
  const devScheme = candidates.find((scheme) => projectPattern.test(scheme) && devPattern.test(scheme));
  if (devScheme) return devScheme;

  const exactProjectScheme = candidates.find((scheme) => scheme.toLowerCase() === projectName.toLowerCase());
  if (exactProjectScheme) return exactProjectScheme;

  const namedProjectScheme = candidates.find((scheme) => projectPattern.test(scheme));
  if (namedProjectScheme) return namedProjectScheme;

  const first = candidates[0];
  if (!first) {
    throw new Error("nativeproof onboard: iOS project has no shared Xcode schemes");
  }
  if (candidates.length > 1) {
    console.warn(
      `nativeproof: multiple Xcode schemes found; building "${first}" (others: ${candidates
        .slice(1)
        .join(
          ", ",
        )}). If that is the wrong scheme, build the app yourself and onboard the produced simulator .app path.`,
    );
  }
  return first;
}

function resolveIosBuildPlan(sourcePath: string, runCommand: NativeBuildCommandRunner): IosBuildPlan {
  const descriptors = findIosProjectDescriptors(sourcePath);
  const failures: string[] = [];
  for (const descriptor of descriptors) {
    const result = runCommand("xcodebuild", [...xcodebuildContainerArgs(descriptor), "-list", "-json"], {
      cwd: sourcePath,
    });
    if (result.code !== 0) {
      failures.push(`${path.basename(descriptor.path)}: xcodebuild -list exited ${result.code}`);
      continue;
    }
    let schemes: string[] = [];
    try {
      schemes = schemesFromXcodebuildList(result.stdout);
    } catch {
      failures.push(`${path.basename(descriptor.path)}: xcodebuild -list did not return JSON`);
      continue;
    }
    if (schemes.length === 0) {
      failures.push(`${path.basename(descriptor.path)}: no shared Xcode schemes`);
      continue;
    }
    return { descriptor, scheme: selectIosScheme(schemes, descriptor.name) };
  }

  const detail = failures.length > 0 ? `\n${failures.map((failure) => `- ${failure}`).join("\n")}` : "";
  throw new Error(`nativeproof onboard: could not find a buildable iOS scheme in ${sourcePath}.${detail}`);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function stageIosAppForOnboarding(appPath: string, cwd: string): string {
  const stagedPath = path.join(cwd, "build", "ios", path.basename(appPath));
  if (path.resolve(stagedPath) === path.resolve(appPath)) return appPath;
  rmSync(stagedPath, { recursive: true, force: true });
  mkdirSync(path.dirname(stagedPath), { recursive: true });
  cpSync(appPath, stagedPath, { recursive: true });
  return stagedPath;
}

export function buildIosProjectForOnboarding(
  sourcePath: string,
  cwd: string,
  runCommand: NativeBuildCommandRunner = runNativeBuildCommand,
): OnboardTarget {
  const plan = resolveIosBuildPlan(sourcePath, runCommand);
  const derivedDataPath = path.join(cwd, ".nativeproof", "ios", "DerivedData");
  const sourcePackagesPath = path.join(cwd, ".nativeproof", "ios", "SourcePackages");
  const packageCachePath = path.join(cwd, ".nativeproof", "ios", "PackageCache");
  mkdirSync(derivedDataPath, { recursive: true });
  mkdirSync(sourcePackagesPath, { recursive: true });
  mkdirSync(packageCachePath, { recursive: true });

  const args = [
    ...xcodebuildContainerArgs(plan.descriptor),
    "-quiet",
    "-scheme",
    plan.scheme,
    "-configuration",
    "Debug",
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    derivedDataPath,
    "-clonedSourcePackagesDirPath",
    sourcePackagesPath,
    "-packageCachePath",
    packageCachePath,
    "-disablePackageRepositoryCache",
    "-skipPackagePluginValidation",
    "-skipMacroValidation",
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "build",
  ];
  console.log(`nativeproof: building iOS simulator app with scheme "${plan.scheme}" …`);
  // `.nativeproof/ios/DerivedData` persists across runs, so after a FAILED rebuild the previous
  // run's `.app` is still sitting there. Snapshot the cache first, then on a nonzero exit accept
  // only an app this build actually produced or refreshed (a new path, or a newer mtime than the
  // cached copy). Comparing filesystem mtimes to each other — not to `Date.now()`, which can read
  // ahead of a just-written file's timestamp on some filesystems — keeps a fresh app from being
  // rejected while still catching a stale one.
  const cachedBefore = new Map(
    discoverBuiltArtifacts(derivedDataPath, "ios").map((artifact) => [artifact.path, artifact.mtimeMs]),
  );
  const result = runCommand("xcodebuild", args, { cwd: sourcePath, stdio: "inherit" });
  const discovered = discoverBuiltArtifacts(derivedDataPath, "ios");
  const builtApp =
    result.code === 0
      ? discovered[0]
      : discovered.find((artifact) => {
          const cachedMtime = cachedBefore.get(artifact.path);
          return cachedMtime === undefined || artifact.mtimeMs > cachedMtime;
        });
  if (!builtApp) {
    const command = `xcodebuild ${args.map(shellArg).join(" ")}`;
    throw new Error(
      `nativeproof onboard: iOS project build did not produce a simulator .app (xcodebuild exited ${result.code}).\nCommand: ${command}\nThe xcodebuild output above has the failure detail. If the project needs custom setup, build it in Xcode and onboard the produced simulator .app path directly.`,
    );
  }

  const stagedAppPath = stageIosAppForOnboarding(builtApp.path, cwd);
  if (result.code !== 0) {
    console.warn(
      `nativeproof: xcodebuild exited ${result.code}, but produced ${pathForConfig(stagedAppPath, cwd)}; continuing with that app.`,
    );
  }
  return { platform: "ios", appPath: stagedAppPath, sourcePath };
}

export interface OnboardOptions {
  platform?: InitPlatform | undefined;
  runCommand?: NativeBuildCommandRunner | undefined;
}

export function resolveOnboardTarget(
  inputPath: string,
  options: OnboardOptions = {},
  cwd: string = process.cwd(),
): OnboardTarget {
  const sourcePath = path.resolve(cwd, inputPath);
  const requested = options.platform;
  const shouldBuildIos =
    existsSync(sourcePath) &&
    isDirectory(sourcePath) &&
    hasIosProjectMarker(sourcePath) &&
    (requested === "ios" || (!requested && !hasAndroidProjectMarker(sourcePath)));
  if (shouldBuildIos) {
    return buildIosProjectForOnboarding(sourcePath, cwd, options.runCommand ?? runNativeBuildCommand);
  }
  return detectOnboardTarget(inputPath, options, cwd);
}

export function detectOnboardTarget(
  inputPath: string,
  options: { platform?: InitPlatform | undefined } = {},
  cwd: string = process.cwd(),
): OnboardTarget {
  const sourcePath = path.resolve(cwd, inputPath);
  if (!existsSync(sourcePath)) {
    throw new Error(`nativeproof onboard: app path does not exist: ${inputPath}`);
  }

  const requested = options.platform;
  if (isFile(sourcePath) && sourcePath.endsWith(".apk")) {
    if (requested && requested !== "android")
      throw new Error("nativeproof onboard: .apk conflicts with --ios");
    return { platform: "android", appPath: sourcePath, sourcePath };
  }

  if (isDirectory(sourcePath) && sourcePath.endsWith(".app")) {
    if (requested && requested !== "ios")
      throw new Error("nativeproof onboard: .app conflicts with --android");
    return { platform: "ios", appPath: sourcePath, sourcePath };
  }

  if (!isDirectory(sourcePath)) {
    throw new Error("nativeproof onboard: expected an Android .apk, iOS .app, or app project directory");
  }

  const discovered = discoverBuiltArtifacts(sourcePath, requested);
  if (discovered.length > 0) {
    const first = discovered[0];
    if (!first) throw new Error("nativeproof onboard: no built app artifact found");
    return { platform: first.platform, appPath: first.path, sourcePath };
  }

  if ((requested === "android" || !requested) && hasAndroidProjectMarker(sourcePath)) {
    throw new Error(
      "nativeproof onboard: Android project detected, but no built .apk was found. Build a debug APK (usually `./gradlew assembleDebug`, run where the Gradle wrapper lives — often the android/ directory) or pass the .apk path.",
    );
  }

  if ((requested === "ios" || !requested) && hasIosProjectMarker(sourcePath)) {
    throw new Error(
      "nativeproof onboard: iOS project detected, but no built .app was found. Build the app for a simulator or pass the .app path.",
    );
  }

  throw new Error("nativeproof onboard: could not detect an iOS .app or Android .apk from the provided path");
}

function pathForConfig(artifactPath: string, cwd: string): string {
  const relative = path.relative(cwd, artifactPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.startsWith(".") ? relative : `./${relative.split(path.sep).join("/")}`;
  }
  return artifactPath.split(path.sep).join("/");
}

function findMatchingBrace(contents: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let index = openIndex; index < contents.length; index += 1) {
    const char = contents[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    // Comments may contain quotes and braces ("// don't pin a model", "/* { */"), which
    // desynced the quote tracker and made onboarding fail on — or rewrite — the wrong block.
    if (char === "/" && contents[index + 1] === "/") {
      const newline = contents.indexOf("\n", index);
      if (newline === -1) return -1;
      index = newline;
      continue;
    }
    if (char === "/" && contents[index + 1] === "*") {
      const close = contents.indexOf("*/", index + 2);
      if (close === -1) return -1;
      index = close + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function updateConfigAppPath(
  contents: string,
  options: { platform: InitPlatform; appPath: string },
): string {
  const platformPattern = new RegExp(`platform:\\s*["']${options.platform}["']`);
  const platformMatch = platformPattern.exec(contents);
  if (!platformMatch) {
    throw new Error(`nativeproof onboard: nativeproof.config.ts has no ${options.platform} project`);
  }

  const objectStart = contents.lastIndexOf("{", platformMatch.index);
  const objectEnd = objectStart >= 0 ? findMatchingBrace(contents, objectStart) : -1;
  if (objectStart < 0 || objectEnd < 0) {
    throw new Error(
      `nativeproof onboard: could not update the ${options.platform} project in nativeproof.config.ts`,
    );
  }

  const before = contents.slice(0, objectStart);
  const block = contents.slice(objectStart, objectEnd + 1);
  const after = contents.slice(objectEnd + 1);
  const appLiteral = JSON.stringify(options.appPath);
  const existingApp = /(["']appium:app["']\s*:\s*)(["'])(?:\\.|(?!\2).)*\2/.exec(block);
  if (existingApp) {
    const updatedBlock = `${block.slice(0, existingApp.index)}${existingApp[1]}${appLiteral}${block.slice(
      existingApp.index + existingApp[0].length,
    )}`;
    return `${before}${updatedBlock}${after}`;
  }

  // An "appium:app" that is not a plain string literal (template literal, variable, import)
  // cannot be rewritten safely — and inserting a second key would silently lose to the
  // existing one, so onboarding would claim success while changing nothing.
  if (/["']appium:app["']\s*:/.test(block)) {
    throw new Error(
      `nativeproof onboard: the ${options.platform} project sets "appium:app" in a form onboarding cannot rewrite. Point it at ${appLiteral} manually.`,
    );
  }

  const capabilities = /capabilities\s*:\s*\{/.exec(block);
  if (!capabilities) {
    throw new Error(`nativeproof onboard: ${options.platform} project has no capabilities object`);
  }
  const insertAt = capabilities.index + capabilities[0].length;
  const updatedBlock = `${block.slice(0, insertAt)}\n        "appium:app": ${appLiteral},${block.slice(insertAt)}`;
  return `${before}${updatedBlock}${after}`;
}

function ensurePackage(
  cwd: string,
  io: ScaffoldIo,
): { created: string[]; skipped: string[]; updated: string[] } {
  const packagePath = path.join(cwd, "package.json");
  if (!io.exists(packagePath)) {
    io.write(packagePath, packageTemplate());
    return { created: ["package.json"], skipped: [], updated: [] };
  }
  const merged = ensurePackageJson(io.read(packagePath));
  if (merged.changed) {
    io.write(packagePath, merged.contents);
    return { created: [], skipped: [], updated: ["package.json"] };
  }
  return { created: [], skipped: ["package.json"], updated: [] };
}

export function onboard(
  cwd: string = process.cwd(),
  inputPath: string,
  options: OnboardOptions = {},
  io: ScaffoldIo = diskIo,
): OnboardResult {
  const target = resolveOnboardTarget(inputPath, options, cwd);
  const appPath = pathForConfig(target.appPath, cwd);
  const configPath = findConfigFile(cwd);
  let created: string[] = [];
  let skipped: string[] = [];
  let updated: string[] = [];

  if (configPath) {
    io.write(configPath, updateConfigAppPath(io.read(configPath), { platform: target.platform, appPath }));
    updated.push(path.basename(configPath));
    const packageResult = ensurePackage(cwd, io);
    created = [...created, ...packageResult.created];
    skipped = [...skipped, ...packageResult.skipped];
    updated = [...updated, ...packageResult.updated];
  } else {
    const scaffoldResult = scaffold(cwd, { platform: target.platform, appPath }, io);
    created = scaffoldResult.created;
    skipped = scaffoldResult.skipped;
    updated = scaffoldResult.updated;
  }

  return { target: { ...target, appPath }, created, skipped, updated };
}

export function onboardCommand(
  cwd: string = process.cwd(),
  inputPath: string,
  options: OnboardOptions = {},
): number {
  const { target, created, skipped, updated } = onboard(cwd, inputPath, options);
  for (const file of created) console.log(`nativeproof: created ${file}`);
  for (const file of updated) console.log(`nativeproof: updated ${file}`);
  for (const file of skipped) console.log(`nativeproof: ${file} already exists — skipped`);
  console.log(`nativeproof: onboarded ${target.platform} app at ${target.appPath}`);
  console.log(
    `\nNext: make tests/example.spec.ts and native.navigate(...) match your app, then run \`npm run test:e2e\` or \`nativeproof --${target.platform}\`.`,
  );
  return 0;
}

function localBin(name: string): string {
  const bin = path.join(process.cwd(), "node_modules", ".bin", name);
  return existsSync(bin) ? bin : name;
}

type AppiumEndpoint = Required<Pick<AppiumOptions, "host" | "port" | "path">>;

function appiumEndpoint(options: AppiumOptions = {}): AppiumEndpoint {
  return {
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 4723,
    path: options.path ?? "/",
  };
}

function appiumUrl(endpoint: AppiumEndpoint): string {
  const basePath = endpoint.path.endsWith("/") ? endpoint.path : `${endpoint.path}/`;
  return `http://${endpoint.host}:${endpoint.port}${basePath}`;
}

async function appiumReachable(options: AppiumOptions = {}): Promise<boolean> {
  const endpoint = appiumEndpoint(options);
  try {
    const response = await fetch(`${appiumUrl(endpoint)}status`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function appiumDriverNameForPlatform(platform: InitPlatform): "uiautomator2" | "xcuitest" {
  return platform === "android" ? "uiautomator2" : "xcuitest";
}

export function appiumDriverListHasDriver(raw: string, driverName: string): boolean {
  const parsed = parseAppiumDriverList(raw);
  return isRecord(parsed) && isRecord(parsed[driverName]);
}

/**
 * `appium driver list --json` prints a JSON object, but npm notices and Appium's own update-check
 * warnings can share stdout, so a bare `JSON.parse` throws and the caller then treats an installed
 * driver as missing and reinstalls it. Pull the JSON object out of the surrounding noise (notices
 * carry no braces) and parse that. ponytail: brace-slice over separating the streams.
 */
function parseAppiumDriverList(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface AppiumCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AppiumCommandRunner = (
  args: readonly string[],
  options?: { stdio?: "pipe" | "inherit" },
) => Promise<AppiumCommandResult>;

const runAppiumCommand: AppiumCommandRunner = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(localBin("appium"), args, {
      stdio: options.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    if (child.stdout) child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    if (child.stderr) child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });

export async function ensureAppiumDriver(
  platform: InitPlatform,
  appium: AppiumOptions | undefined,
  runCommand: AppiumCommandRunner = runAppiumCommand,
): Promise<boolean> {
  if (appium?.autoInstallDrivers === false) return false;
  if (platform === "ios" && process.platform !== "darwin") {
    throw new Error("nativeproof: iOS runs require macOS with Xcode and the Appium XCUITest driver");
  }

  const driverName = appiumDriverNameForPlatform(platform);
  const list = await runCommand(["driver", "list", "--installed", "--json"]);
  if (list.code === 0 && appiumDriverListHasDriver(list.stdout, driverName)) return false;

  console.log(`nativeproof: installing Appium ${driverName} driver …`);
  const install = await runCommand(["driver", "install", driverName], { stdio: "inherit" });
  if (install.code !== 0) {
    const iosHint =
      platform === "ios"
        ? " XCUITest needs full Xcode installed (`xcode-select -p` should point at Xcode.app, not CommandLineTools)."
        : "";
    throw new Error(
      `nativeproof: could not install the Appium ${driverName} driver.${iosHint} Run \`npx appium driver install ${driverName}\` and retry.`,
    );
  }
  return true;
}

async function ensureAppium(
  appium: AppiumOptions | undefined,
  startAppium: boolean,
  platform: InitPlatform,
): Promise<ChildProcess | null> {
  const endpoint = appiumEndpoint(appium);
  if (await appiumReachable(endpoint)) return null;
  if (!startAppium) {
    throw new Error(`Appium is not reachable at ${appiumUrl(endpoint)} (and --no-appium was set)`);
  }
  await ensureAppiumDriver(platform, appium);
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
  let startError: Error | undefined;
  let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.on("error", (error) => {
    startError = error;
  });
  child.on("exit", (code, signal) => {
    earlyExit = { code, signal };
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (startError) {
      throw new Error(`nativeproof: could not start Appium at ${appiumUrl(endpoint)}: ${startError.message}`);
    }
    if (earlyExit) {
      const status = earlyExit.signal ? `signal ${earlyExit.signal}` : `exit code ${earlyExit.code ?? 1}`;
      throw new Error(
        `nativeproof: Appium exited before becoming reachable at ${appiumUrl(endpoint)} (${status}). If another Appium is already using this port, set appium.path to its base path or stop it.`,
      );
    }
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

type CliSignal = "SIGINT" | "SIGTERM";

interface KillableChild {
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

interface SignalSource {
  once(signal: CliSignal, listener: (signal: CliSignal) => void): unknown;
  off(signal: CliSignal, listener: (signal: CliSignal) => void): unknown;
}

function signalExitCode(signal: CliSignal): number {
  return signal === "SIGINT" ? 130 : 143;
}

function killChild(child: KillableChild | null | undefined, signal: CliSignal): void {
  if (child && !child.killed) child.kill(signal);
}

export function waitForRunnerExit(
  runner: KillableChild,
  appium: KillableChild | null,
  signals: SignalSource = process,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signals.off("SIGINT", onSignal);
      signals.off("SIGTERM", onSignal);
      complete();
    };
    const onSignal = (signal: CliSignal): void => {
      killChild(runner, signal);
      killChild(appium, signal);
      settle(() => resolve(signalExitCode(signal)));
    };

    signals.once("SIGINT", onSignal);
    signals.once("SIGTERM", onSignal);
    runner.on("error", (error) => settle(() => reject(error)));
    runner.on("exit", (code) => settle(() => resolve(code ?? 1)));
  });
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
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  try {
    const loaded = await import(pathToFileURL(configPath).href);
    const config = nativeProofConfigFromModule(loaded);
    if (!config) {
      throw new Error(`${configPath} must \`export default defineConfig(...)\``);
    }
    return config;
  } finally {
    unregister?.();
  }
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

/**
 * The selection the preflight resolves the project with: CLI flags first, then the same
 * env vars the runner itself reads (PLATFORM / NATIVEPROOF_PROJECT). Without the env
 * fallback, `PLATFORM=ios nativeproof` preflighted the android project (wrong Appium
 * driver ensured, macOS guard skipped) and then ran the ios one.
 */
export function runSelection(args: CliArgs, env: NodeJS.ProcessEnv = process.env): RunnerEnv {
  const selection: RunnerEnv = {};
  const platform = args.platform ?? env.PLATFORM;
  const project = args.project ?? env.NATIVEPROOF_PROJECT;
  if (platform) selection.platform = platform;
  if (project) selection.project = project;
  return selection;
}

/**
 * `nativeproof inspect` — selector discovery (issue #23, step 2): start a session with the
 * configured project (noReset so app state survives), dump the first screen's candidate
 * locators, and tear the session down. Kills the read-the-XML-and-guess authoring loop.
 */
async function runInspect(args: CliArgs): Promise<number> {
  const { configPath } = resolveRunner(args);
  const userConfig = await loadNativeProofConfig(configPath);
  const project = resolveProject(userConfig, runSelection(args));
  const appium = await ensureAppium(userConfig.appium, args.startAppium, project.platform);
  try {
    const { remote } = await import("webdriverio");
    const endpoint = appiumEndpoint(userConfig.appium);
    const session = await remote({
      hostname: endpoint.host,
      port: endpoint.port,
      path: endpoint.path,
      logLevel: "warn",
      capabilities: { ...projectCapabilities(userConfig, project), "appium:noReset": true },
    });
    try {
      const source = await session.getPageSource();
      const suggestions = selectorSuggestions(source, project.platform);
      console.log(
        `nativeproof inspect — ${suggestions.length} candidate locators on the current ${project.platform} screen\n`,
      );
      for (const suggestion of suggestions) console.log(`  ${suggestion}`);
    } finally {
      await session.deleteSession().catch(() => {});
    }
    return 0;
  } finally {
    appium?.kill();
  }
}

async function runTests(args: CliArgs): Promise<number> {
  const { wdioConfig, configPath, extraEnv } = resolveRunner(args);
  const userConfig = await loadNativeProofConfig(configPath);
  const project = resolveProject(userConfig, runSelection(args));
  const appium = await ensureAppium(userConfig.appium, args.startAppium, project.platform);
  try {
    const runner = spawn(localBin("wdio"), ["run", wdioConfig], {
      stdio: "inherit",
      env: { ...runnerEnv(args), ...extraEnv },
    });
    return await waitForRunnerExit(runner, appium);
  } finally {
    appium?.kill();
  }
}

export async function main(
  argv: readonly string[],
  options: { programName?: string | undefined } = {},
): Promise<number> {
  const args = parseArgs(argv, {
    defaultCommand: defaultCommandForProgram(options.programName ?? process.argv[1]),
  });
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
  if (args.command === "onboard") {
    if (!args.onboardPath) {
      throw new Error(
        "nativeproof onboard requires a path to an iOS .app, iOS project, Android .apk, or built app project",
      );
    }
    return onboardCommand(process.cwd(), args.onboardPath, { platform: args.platform ?? undefined });
  }
  if (args.command === "inspect") {
    return runInspect(args);
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
  main(process.argv.slice(2), { programName: process.argv[1] }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
