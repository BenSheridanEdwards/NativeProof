import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scaffoldFiles } from "../src/cli.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function section(title: string): string {
  const start = readme.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `missing README section: ${title}`);
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}

function normalizeGeneratedSource(source: string): string {
  return source.replace(/\r\n/g, "\n").trimEnd();
}

function extractFirstTsFence(markdown: string): string {
  const open = markdown.indexOf("```ts\n");
  assert.notEqual(open, -1, "expected a ```ts fenced sample");
  const bodyStart = open + "```ts\n".length;
  const close = markdown.indexOf("\n```", bodyStart);
  assert.notEqual(close, -1, "expected closing fence for ```ts sample");
  return normalizeGeneratedSource(markdown.slice(bodyStart, close));
}

test("What Init Creates sample matches the generated config shape", () => {
  const init = section("What Init Creates");
  const generatedConfig = scaffoldFiles({ platform: "ios" }).find(
    (file) => file.path === "nativeproof.config.ts",
  );
  if (!generatedConfig) {
    assert.fail("expected the iOS scaffold config");
  }
  const generatedContents = generatedConfig.contents;

  assert.match(init, /tsconfig\.json/);
  assert.match(init, /\.gitignore/);
  assert.match(init, /TypeScript/);
  assert.match(init, /const driver = \(\) => wdioDriver\(\);/);
  assert.match(init, /driver,/);
  assert.match(init, /mochaTimeout: 240_000/);
  for (const retryLine of [
    "specFileRetries: 1",
    "specFileRetriesDelay: 2",
    "A retry starts a fresh Appium session",
  ]) {
    assert.match(generatedContents, new RegExp(retryLine));
    assert.match(init, new RegExp(retryLine));
  }
  assert.match(init, /name: "ios"/);
  assert.doesNotMatch(init, /name: "android"/);

  // Full-file parity: README sample must equal scaffold output (not just share tokens).
  // Loose token checks alone false-greened when README claimed retries the scaffold omitted.
  assert.equal(
    extractFirstTsFence(init),
    normalizeGeneratedSource(generatedContents),
    'README What Init Creates ```ts sample must equal scaffoldFiles({ platform: "ios" }) config',
  );
});

test("mocking docs do not promote top-level fixed-port mock startup in config", () => {
  assert.doesNotMatch(readme, /export\s+const\s+mock\s*=\s*await\s+startMockServer\(\{\s*port:/);
  assert.match(readme, /do not start a fixed-port mock server at\s+config top level/);
});

test("mocking docs explain traffic assertion and websocket reject semantics", () => {
  const mocking = section("Mocking And Backend Setup");

  assert.match(mocking, /expect\(mock\)\.not\.toHaveSent/);
  assert.match(mocking, /append-only log/);
  assert.match(mocking, /only after the action that could send the frame has finished/);
  assert.match(mocking, /HTTP status/);
  assert.match(mocking, /WebSocket close code/);
  assert.match(mocking, /3000.*4999/);
  assert.match(mocking, /close as `4000`/);
});
