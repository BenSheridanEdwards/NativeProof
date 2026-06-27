import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  helpText,
  loadNativeProofConfig,
  main,
  parseArgs,
  resolveRunner,
  type ScaffoldIo,
  scaffold,
  scaffoldFiles,
  version,
} from "../src/cli.js";

/**
 * CLI argument parsing + runner resolution — pure, no spawning. Importing the module
 * does not run `main` (it is guarded to only execute when the file is the process entry).
 */
test("parseArgs defaults to the test command with sensible defaults", () => {
  const args = parseArgs([]);
  assert.equal(args.command, "test");
  assert.equal(args.project, undefined);
  assert.equal(args.startAppium, true);
  assert.equal(args.platform, undefined);
  assert.equal(args.initPlatform, undefined);
});

test("parseArgs reads platform, project, spec and --no-appium", () => {
  const args = parseArgs([
    "test",
    "--platform",
    "ios",
    "--project",
    "tablet",
    "--spec",
    "a.spec.ts",
    "--no-appium",
  ]);
  assert.equal(args.platform, "ios");
  assert.equal(args.initPlatform, "ios");
  assert.equal(args.project, "tablet");
  assert.equal(args.spec, "a.spec.ts");
  assert.equal(args.startAppium, false);
});

test("parseArgs surfaces --help and --version", () => {
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["-v"]).command, "version");
});

test("parseArgs rejects an invalid platform, a missing value, and unknown flags", () => {
  assert.throws(() => parseArgs(["--platform", "windows"]), /android.*ios/);
  assert.throws(() => parseArgs(["init", "--ios", "--android"]), /conflicts/);
  assert.throws(() => parseArgs(["--config", "wdio.conf.ts"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--appium-host", "10.0.0.5"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
});

test("resolveRunner errors when no config is discoverable", () => {
  assert.throws(
    () => resolveRunner(parseArgs([]), "/tmp/nativeproof-nonexistent-xyz"),
    /no nativeproof\.config/,
  );
});

test("resolveRunner ignores raw WebdriverIO configs and requires nativeproof.config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    writeFileSync(path.join(dir, "wdio.conf.ts"), "export const config = {};\n");
    assert.throws(() => resolveRunner(parseArgs([]), dir), /no nativeproof\.config/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNativeProofConfig imports a TypeScript config", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    const configPath = path.join(dir, "nativeproof.config.ts");
    writeFileSync(
      configPath,
      [
        "const port: number = 4724;",
        'export default { appium: { host: "10.0.0.5", port, path: "/" }, projects: [{ name: "android", platform: "android" }] };',
      ].join("\n"),
    );
    const config = await loadNativeProofConfig(configPath);
    assert.equal(config.appium?.host, "10.0.0.5");
    assert.equal(config.appium?.port, 4724);
    assert.equal(config.appium?.path, "/");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadNativeProofConfig errors when the config has no default export", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nativeproof-cli-"));
  try {
    const configPath = path.join(dir, "nativeproof.config.ts");
    writeFileSync(configPath, "export const nope = 1;\n");
    await assert.rejects(() => loadNativeProofConfig(configPath), /export default defineConfig/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helpText names the native E2E layer and version is semver", () => {
  assert.match(helpText(), /Playwright-feeling native mobile E2E/);
  assert.match(version(), /^\d+\.\d+\.\d+$/);
});

test("parseArgs surfaces the init command, and help lists it", () => {
  const args = parseArgs(["init", "--ios"]);
  assert.equal(args.command, "init");
  assert.equal(args.initPlatform, "ios");
  assert.match(helpText(), /nativeproof init --ios/);
  assert.match(helpText(), /nativeproof init --android/);
});

test("main rejects init without an explicit platform", async () => {
  await assert.rejects(() => main(["init"]), /init requires --ios or --android/);
});

test("scaffoldFiles are a platform-specific config, package script and readable spec", () => {
  const files = scaffoldFiles({ platform: "ios" });
  const config = files.find((f) => f.path === "nativeproof.config.ts");
  const spec = files.find((f) => f.path === "tests/example.spec.ts");
  const pkg = files.find((f) => f.path === "package.json");
  assert.ok(config, "writes nativeproof.config.ts");
  assert.ok(spec, "writes a sample spec");
  assert.ok(pkg, "writes package.json with an npm script");
  // The config owns app/device control and exports the direct native surface specs use.
  assert.match(config.contents, /createNative\(/);
  assert.match(config.contents, /export const native/);
  assert.match(config.contents, /export default defineConfig\(/);
  assert.match(config.contents, /platform: "ios"/);
  assert.doesNotMatch(config.contents, /platform: "android"/);
  assert.match(config.contents, /artifacts: \{ dir: "\.e2e-artifacts" \}/);
  assert.match(config.contents, /"appium:app": "\.\/build\/ios\/MyApp\.app"/);
  assert.doesNotMatch(config.contents, /process\.env\.NATIVEPROOF/);
  // The spec imports the config-owned native surface and uses runner-native words.
  assert.match(spec.contents, /from "\.\.\/nativeproof\.config"/);
  assert.match(spec.contents, /describe\("login"/);
  assert.match(spec.contents, /it\("should be able to log in"/);
  assert.match(spec.contents, /native\.tap\("Log in"\)/);
  assert.doesNotMatch(spec.contents, /test\.describe\(/);
  assert.match(pkg.contents, /"test:e2e": "nativeproof"/);
});

test("scaffold writes missing files and never overwrites existing ones", () => {
  const written = new Map<string, string>();
  const present = new Set<string>(["/proj/nativeproof.config.ts"]); // config already exists
  const io: ScaffoldIo = {
    exists: (file) => present.has(file),
    read: () => {
      throw new Error("read should not be called for missing package.json");
    },
    write: (file, contents) => written.set(file, contents),
  };
  const { created, skipped, updated } = scaffold("/proj", { platform: "android" }, io);
  assert.deepEqual(created, ["tests/example.spec.ts", "package.json"]);
  assert.deepEqual(skipped, ["nativeproof.config.ts"]); // existing one left intact
  assert.deepEqual(updated, []);
  assert.equal(written.has("/proj/nativeproof.config.ts"), false);
  assert.ok(written.get("/proj/tests/example.spec.ts")?.includes('describe("login"'));
  assert.ok(written.get("/proj/package.json")?.includes('"test:e2e": "nativeproof"'));
});

test("scaffold updates an existing package.json without overwriting its scripts", () => {
  const written = new Map<string, string>();
  const present = new Set<string>(["/proj/package.json"]);
  const io: ScaffoldIo = {
    exists: (file) => present.has(file),
    read: () => JSON.stringify({ name: "app", scripts: { test: "vitest" } }),
    write: (file, contents) => written.set(file, contents),
  };
  const { created, skipped, updated } = scaffold("/proj", { platform: "android" }, io);
  assert.deepEqual(created, ["nativeproof.config.ts", "tests/example.spec.ts"]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(updated, ["package.json"]);
  const pkg = JSON.parse(written.get("/proj/package.json") ?? "{}") as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.scripts?.test, "vitest");
  assert.equal(pkg.scripts?.["test:e2e"], "nativeproof");
  assert.equal(pkg.devDependencies?.nativeproof, "latest");
});
