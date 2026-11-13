import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { consumer, run } from "./harness.js";

test("packed CLI and declarations work in an independent install", () => {
  const fixture = consumer();
  const { cwd } = fixture;
  try {
    const bin = (name: string) => path.join(cwd, "node_modules/.bin", name);
    assert.match(run(bin("nativeproof"), ["--help"], cwd).output, /nativeproof/);
    run(bin("nativeproof-init"), ["--ios"], cwd);
    assert.match(readFileSync(path.join(cwd, "nativeproof.config.ts"), "utf8"), /ios/i);
    const android = path.join(cwd, "android");
    mkdirSync(android);
    writeFileSync(path.join(android, "Example.apk"), "");
    run(bin("nativeproof-onboard"), ["./Example.apk"], android);
    assert.match(readFileSync(path.join(android, "nativeproof.config.ts"), "utf8"), /Example\.apk/);
    writeFileSync(
      path.join(cwd, "import.ts"),
      'import * as nativeproof from "nativeproof"; void nativeproof;\n',
    );
    run(
      bin("tsc"),
      ["--noEmit", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2022", "import.ts"],
      cwd,
    );
  } finally {
    fixture.cleanup();
  }
});
