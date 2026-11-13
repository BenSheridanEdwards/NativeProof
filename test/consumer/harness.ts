import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const logs = path.join(root, "consumer-results");
mkdirSync(logs, { recursive: true });
export function run(command: string, args: string[], cwd: string, failure = false) {
  const env = { ...process.env };
  delete env.NODE_PATH;
  if (cwd !== root) {
    env.npm_config_prefix = path.join(cwd, ".prefix");
    env.npm_config_cache = path.join(cwd, ".cache");
  }
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 240000 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  appendFileSync(path.join(logs, `${process.pid}.log`), `${command} ${args.join(" ")}\n${output}\n`);
  if (/EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|E401|E403|E404|E502|E503/.test(output)) {
    throw new Error(`UNAVAILABLE: ${output}`);
  }
  assert.ifError(result.error);
  if (!failure) assert.equal(result.status, 0, output);
  return { status: result.status, output, stdout: result.stdout };
}
export function consumer(fault?: "tsx" | "onboard") {
  const scratch = mkdtempSync(path.join(tmpdir(), "nativeproof-consumer-"));
  try {
    run("npm", ["run", "build"], root);
    const packed = JSON.parse(
      run("npm", ["pack", "--json", "--pack-destination", scratch], root).stdout.trim(),
    ) as { filename: string }[];
    assert.ok(packed[0]);
    let tarball = path.join(scratch, packed[0].filename);
    if (fault) {
      run("tar", ["-xzf", tarball, "-C", scratch], scratch);
      const pkgPath = path.join(scratch, "package", "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (fault === "tsx") {
        delete pkg.dependencies.tsx;
        writeFileSync(pkgPath, JSON.stringify(pkg));
      } else rmSync(path.join(scratch, "package", "dist", "nativeproof-onboard.js"));
      tarball = path.join(scratch, "broken.tgz");
      run("tar", ["-czf", tarball, "package"], scratch);
    }
    const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    writeFileSync(path.join(logs, `${process.pid}-${fault ?? "installed"}.sha256`), `${digest}\n`);
    writeFileSync(path.join(logs, `${process.pid}.sha`), run("git", ["rev-parse", "HEAD"], root).output);
    const cwd = path.join(scratch, "consumer");
    mkdirSync(cwd);
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", tarball, "typescript@5.9.3", "@types/node@24"], cwd);
    return { cwd, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}
export function faultProof(fault: "tsx" | "onboard") {
  const fixture = consumer(fault);
  try {
    const entry = fault === "tsx" ? "cli.js" : "nativeproof-onboard.js";
    const result = run(
      process.execPath,
      [path.join(fixture.cwd, "node_modules/nativeproof/dist", entry), "--help"],
      fixture.cwd,
      true,
    );
    assert.notEqual(result.status, 0, "broken package must fail");
    assert.match(
      result.output,
      fault === "tsx"
        ? /Cannot find (?:package|module) 'tsx'/
        : /Cannot find module .*nativeproof-onboard\.js/,
    );
  } finally {
    fixture.cleanup();
  }
}
