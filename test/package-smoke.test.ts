import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      ...options.env,
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

test("packed package exposes the onboarding CLI bins and a real tarball consumer project", () => {
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
    assert.ok(packedFiles.has("README.md"), "packed package includes README.md");
    assert.ok(packedFiles.has("LICENSE"), "packed package includes LICENSE");
    assert.ok(packedFiles.has("dist/cli.js"), "packed package includes the CLI entrypoint");
    assert.ok(packedFiles.has("dist/index.js"), "packed package includes the public module entrypoint");

    run("tar", ["-xzf", tarball, "-C", tempDir], { cwd: process.cwd() });
    const packageRoot = path.join(tempDir, "package");
    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
      type?: string;
      version?: string;
      engines?: { node?: string };
    };

    assert.equal(packageJson.type, "module");
    assert.equal(typeof packageJson.version, "string");
    assert.deepEqual(packageJson.files, ["dist", "CHANGELOG.md", "README.md", "LICENSE"]);
    assert.equal(packageJson.engines?.node, "^20.19.0 || ^22.12.0 || >=24.0.0");
    assert.deepEqual(packageJson.bin, {
      nativeproof: "dist/cli.js",
      "nativeproof-init": "dist/nativeproof-init.js",
      "nativeproof-onboard": "dist/nativeproof-onboard.js",
    });

    const cliEntry = path.join(packageRoot, "dist", "cli.js");
    const initEntry = path.join(packageRoot, "dist", "nativeproof-init.js");
    const onboardEntry = path.join(packageRoot, "dist", "nativeproof-onboard.js");
    assert.ok(readFileSync(cliEntry, "utf8").startsWith("#!/usr/bin/env node"), "packed CLI keeps shebang");
    assert.ok(readFileSync(initEntry, "utf8").startsWith("#!/usr/bin/env node"));
    assert.ok(readFileSync(onboardEntry, "utf8").startsWith("#!/usr/bin/env node"));
    assert.match(readFileSync(cliEntry, "utf8"), /nativeproof-onboard/);

    // Fresh consumer project: scaffold and install from the packed tarball (not a repo symlink).
    const iosProject = path.join(tempDir, "fresh-ios-project");
    mkdirSync(iosProject);
    run("npm", ["exec", "--yes", `--package=${tarball}`, "--", "nativeproof", "init", "--ios"], {
      cwd: iosProject,
    });

    const iosPackageJsonPath = path.join(iosProject, "package.json");
    const iosPackageJson = JSON.parse(readFileSync(iosPackageJsonPath, "utf8")) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      type?: string;
    };
    assert.equal(iosPackageJson.type, "module");
    assert.equal(iosPackageJson.scripts?.["test:e2e"], "nativeproof");
    assert.equal(iosPackageJson.devDependencies?.nativeproof, `^${packageJson.version}`);
    assert.equal(typeof iosPackageJson.devDependencies?.typescript, "string");
    assert.equal(typeof iosPackageJson.devDependencies?.["@types/node"], "string");
    assert.match(
      readFileSync(path.join(iosProject, "tests", "example.spec.ts"), "utf8"),
      /native\.tap\("Log in"\)/,
    );
    assert.match(readFileSync(path.join(iosProject, ".gitignore"), "utf8"), /node_modules\//);

    // Pin the local packed build so this proves the current change, not npm "latest".
    iosPackageJson.devDependencies = {
      ...iosPackageJson.devDependencies,
      nativeproof: tarball,
    };
    writeFileSync(iosPackageJsonPath, `${JSON.stringify(iosPackageJson, null, 2)}\n`);

    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: iosProject });

    const helpText = run("npx", ["nativeproof", "--help"], { cwd: iosProject });
    assert.match(helpText, /nativeproof init --ios/);
    assert.match(helpText, /nativeproof init --android/);
    assert.match(helpText, /nativeproof onboard <path>/);
    assert.match(helpText, /nativeproof-onboard <path>/);

    const configImport = run(
      "npx",
      [
        "tsx",
        "--eval",
        "import('./nativeproof.config.ts').then(() => console.log('config imports cleanly'))",
      ],
      { cwd: iosProject },
    );
    assert.match(configImport, /config imports cleanly/);

    const typecheck = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], { cwd: iosProject });
    assert.equal(typecheck.trim(), "");

    const onboardProject = path.join(tempDir, "fresh-onboard-project");
    mkdirSync(onboardProject);
    writeFileSync(path.join(onboardProject, "Example.apk"), "");
    run("npm", ["exec", "--yes", `--package=${tarball}`, "--", "nativeproof", "onboard", "./Example.apk"], {
      cwd: onboardProject,
    });
    assert.match(
      readFileSync(path.join(onboardProject, "nativeproof.config.ts"), "utf8"),
      /"appium:app": "\.\/Example\.apk"/,
    );
    const onboardPackageJson = JSON.parse(
      readFileSync(path.join(onboardProject, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
      type?: string;
    };
    assert.equal(onboardPackageJson.type, "module");
    assert.equal(onboardPackageJson.devDependencies?.nativeproof, `^${packageJson.version}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
