import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("mocking docs do not promote top-level fixed-port mock startup in config", () => {
  assert.doesNotMatch(readme, /export\s+const\s+mock\s*=\s*await\s+startMockServer\(\{\s*port:/);
  assert.match(readme, /do not start a fixed-port mock server at\s+config top level/);
});
