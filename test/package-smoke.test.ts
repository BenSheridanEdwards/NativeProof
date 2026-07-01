import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

function run(command: string, args: readonly string[], options: { cwd: string }): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return result.stdout;
}

test("packed package exposes the onboarding CLI bins and ESM scaffold", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nativeproof-pack-"));
  try {
    const packOutput = run("npm", ["pack", "--pack-destination", tempDir, "--json"], {
      cwd: process.cwd(),
    });
    const [packedPackage] = JSON.parse(packOutput) as [{ filename: string; files: Array<{ path: string }> }];
    assert.ok(packedPackage, "npm pack reports the packed package");

    const tarball = path.join(tempDir, packedPackage.filename);
    assert.ok(existsSync(tarball), `expected ${tarball} to exist`);

    const packedFiles = new Set(packedPackage.files.map((file) => file.path));
    assert.ok(packedFiles.has("package.json"), "packed package includes package.json");
    assert.ok(packedFiles.has("CHANGELOG.md"), "packed package includes CHANGELOG.md");
    assert.ok(packedFiles.has("dist/cli.js"), "packed package includes the CLI entrypoint");
    assert.ok(packedFiles.has("dist/index.js"), "packed package includes the public module entrypoint");

    run("tar", ["-xzf", tarball, "-C", tempDir], { cwd: process.cwd() });
    const packageRoot = path.join(tempDir, "package");
    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
      type?: string;
    };

    assert.equal(packageJson.type, "module");
    assert.deepEqual(packageJson.files, ["dist", "CHANGELOG.md"]);
    assert.deepEqual(packageJson.bin, {
      nativeproof: "dist/cli.js",
      "nativeproof-init": "dist/cli.js",
      "nativeproof-onboard": "dist/cli.js",
    });

    const cliEntry = path.join(packageRoot, "dist", "cli.js");
    const cliSource = readFileSync(cliEntry, "utf8");
    assert.ok(cliSource.startsWith("#!/usr/bin/env node"), "packed CLI keeps the executable shebang");
    assert.match(cliSource, /nativeproof-onboard/);

    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(packageRoot, "node_modules"), "dir");
    const helpText = run(process.execPath, [cliEntry, "--help"], { cwd: packageRoot });
    assert.match(helpText, /nativeproof init --ios/);
    assert.match(helpText, /nativeproof init --android/);
    assert.match(helpText, /nativeproof onboard <path>/);
    assert.match(helpText, /nativeproof-onboard <path>/);

    const iosProject = path.join(tempDir, "fresh-ios-project");
    mkdirSync(iosProject);
    run(process.execPath, [cliEntry, "init", "--ios"], { cwd: iosProject });
    const iosPackageJson = JSON.parse(readFileSync(path.join(iosProject, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      type?: string;
    };
    assert.equal(iosPackageJson.type, "module");
    assert.equal(iosPackageJson.scripts?.["test:e2e"], "nativeproof");
    assert.equal(iosPackageJson.devDependencies?.nativeproof, "latest");
    assert.match(
      readFileSync(path.join(iosProject, "tests", "example.spec.ts"), "utf8"),
      /native\.tap\("Log in"\)/,
    );

    const onboardProject = path.join(tempDir, "fresh-onboard-project");
    mkdirSync(onboardProject);
    writeFileSync(path.join(onboardProject, "Example.apk"), "");
    run(process.execPath, [cliEntry, "onboard", "./Example.apk"], { cwd: onboardProject });
    assert.match(
      readFileSync(path.join(onboardProject, "nativeproof.config.ts"), "utf8"),
      /"appium:app": "\.\/Example\.apk"/,
    );
    assert.equal(JSON.parse(readFileSync(path.join(onboardProject, "package.json"), "utf8")).type, "module");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
