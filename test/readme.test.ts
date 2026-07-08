import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function section(title: string): string {
  const start = readme.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `missing README section: ${title}`);
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}

test("What Init Creates sample matches the generated config shape", () => {
  const init = section("What Init Creates");

  assert.match(init, /tsconfig\.json/);
  assert.match(init, /const driver = \(\) => wdioDriver\(\);/);
  assert.match(init, /driver,/);
  assert.match(init, /mochaTimeout: 240_000/);
  assert.match(init, /name: "ios"/);
  assert.doesNotMatch(init, /name: "android"/);
});

test("mocking docs do not promote top-level fixed-port mock startup in config", () => {
  assert.doesNotMatch(readme, /export\s+const\s+mock\s*=\s*await\s+startMockServer\(\{\s*port:/);
  assert.match(readme, /do not start a fixed-port mock server at\s+config top level/);
});
