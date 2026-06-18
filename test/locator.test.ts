import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver, Platform } from "../src/driver.js";
import { expect } from "../src/expect.js";
import { by, Locator } from "../src/locator.js";

/**
 * Locator + expect coverage driven by an in-memory fake device — no emulator, no
 * WebDriver session. Proves the selectors, auto-waiting and matchers in isolation.
 */
class FakeDriver implements Driver {
  platform: Platform = "android";
  readonly taps: Array<{ x: number; y: number }> = [];
  private readonly sources: string[];

  constructor(...sources: string[]) {
    this.sources = sources.length > 0 ? sources : [""];
  }

  async source(): Promise<string> {
    // Advance through queued sources, holding the last — models a screen settling.
    if (this.sources.length > 1) return this.sources.shift() ?? "";
    return this.sources[0] ?? "";
  }

  async pause(_ms: number): Promise<void> {}

  async tapAt(x: number, y: number): Promise<void> {
    this.taps.push({ x, y });
  }
}

const SETTLED =
  '<node content-desc="Sign out" bounds="[0,0][100,100]" />' +
  '<node text="E2E sample text node" bounds="[0,200][1080,300]" />';

test("locators match, read and tap labels the source XML-escaped", async () => {
  const driver = new FakeDriver('<node text="Save &amp; Close" bounds="[0,0][120,60]" />');
  const loc = new Locator(driver, by.text("Save & Close")); // a plain, human-readable string
  assert.equal(await loc.isVisible(), true);
  assert.equal(await loc.textContent(), "Save & Close"); // decoded back from the source
  await expect(loc).toShow("Save & Close");
  await loc.tap();
  assert.deepEqual(driver.taps, [{ x: 60, y: 30 }]);
});

test("Locator.isVisible reflects whether the selector matches the source", async () => {
  const driver = new FakeDriver(SETTLED);
  assert.equal(await new Locator(driver, by.desc("Sign out")).isVisible(), true);
  assert.equal(await new Locator(driver, by.desc("Open menu")).isVisible(), false);
});

test("Locator.tap taps the matched node's centre via a source-bounds fallback", async () => {
  const driver = new FakeDriver(SETTLED);
  await new Locator(driver, by.desc("Sign out")).tap();
  assert.deepEqual(driver.taps, [{ x: 50, y: 50 }]);
});

test("expect(locator).toShow passes when the locator is present and the text is shown", async () => {
  const driver = new FakeDriver(SETTLED);
  await expect(new Locator(driver, by.desc("Sign out"))).toShow("E2E sample text node");
});

test("expect(locator).toBeVisible auto-waits across polls until the element appears", async () => {
  const driver = new FakeDriver("", SETTLED); // first poll empty (loading), then settled
  await expect(new Locator(driver, by.desc("Sign out"))).toBeVisible({ timeout: 1000, interval: 1 });
});

test("expect(locator).not.toBeVisible passes for an absent selector", async () => {
  const driver = new FakeDriver(SETTLED);
  await expect(new Locator(driver, by.id("nonexistent"))).not.toBeVisible({ timeout: 50, interval: 5 });
});

test("expect(locator).toBeVisible rejects when the element never appears", async () => {
  const driver = new FakeDriver("");
  await assert.rejects(
    () => expect(new Locator(driver, by.text("Never"))).toBeVisible({ timeout: 30, interval: 5 }),
    /to be visible/,
  );
});
