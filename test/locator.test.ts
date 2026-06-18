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
  readonly typed: string[] = [];
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

  async typeText(text: string): Promise<void> {
    this.typed.push(text);
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

test("by.text matches a label exposed as content-desc (Compose), not just text=", async () => {
  const driver = new FakeDriver('<node text="" content-desc="Add to cart" bounds="[10,10][110,60]" />');
  const loc = new Locator(driver, by.text("Add to cart"));
  assert.equal(await loc.isVisible(), true);
  const b = await loc.bounds();
  assert.ok(b);
  assert.equal(b.centerX, 60);
});

test("regex selectors match, read and locate a label by pattern (decoded, case-insensitive)", async () => {
  const driver = new FakeDriver(
    '<node text="Save &amp; Close" bounds="[0,0][120,60]" /><node text="Cancel" bounds="[0,80][120,140]" />',
  );
  // A RegExp is tested against the DECODED value, so the human pattern matches escaped source.
  const save = new Locator(driver, by.text(/save & /i));
  assert.equal(await save.isVisible(), true);
  assert.equal(await save.textContent(), "Save & Close");
  const b = await save.bounds();
  assert.ok(b);
  assert.equal(b.centerY, 30); // located the "Save" row, not "Cancel"
  await expect(save).toBeVisible();
  assert.equal(await new Locator(driver, by.text(/^nope$/)).isVisible(), false);
});

test("checkbox state — isChecked, check()/uncheck() drive it, expect(...).toBeChecked()", async () => {
  let checked = false; // a tap toggles the box, modelling a real checkbox
  const driver: Driver = {
    platform: "android",
    async source() {
      return `<node content-desc="Notifications" class="android.widget.CheckBox" checked="${checked}" bounds="[0,0][80,80]" />`;
    },
    async pause() {},
    async tapAt() {
      checked = !checked;
    },
  };
  const box = new Locator(driver, by.label("Notifications"));
  assert.equal(await box.isChecked(), false);
  await expect(box).not.toBeChecked();
  await box.check(); // taps once: false → true
  assert.equal(await box.isChecked(), true);
  await expect(box).toBeChecked();
  await box.check(); // already checked → no-op, no toggle
  assert.equal(await box.isChecked(), true);
  await box.uncheck(); // taps once: true → false
  await expect(box).not.toBeChecked();
});

test("textContent prefers a non-empty label over an empty value on iOS (and decodes entities)", async () => {
  const driver = new FakeDriver('<node label="Save &amp; Close" value="" bounds="[0,0][120,60]" />');
  driver.platform = "ios";
  const loc = new Locator(driver, by.text("Save & Close"));
  assert.equal(await loc.textContent(), "Save & Close"); // not "" from the empty value=
});

test("textContent falls back to content-desc when text is empty on Android (Compose)", async () => {
  const driver = new FakeDriver('<node text="" content-desc="Add to cart" bounds="[10,10][110,60]" />');
  assert.equal(await new Locator(driver, by.text("Add to cart")).textContent(), "Add to cart");
});

test("tap({ clickableAncestor: true }) taps the clickable parent of a non-clickable label", async () => {
  const source =
    '<node clickable="true" bounds="[0,0][300,400]">' +
    '<node text="Tap me" clickable="false" bounds="[50,90][150,110]" /></node>';
  const driver = new FakeDriver(source);
  const loc = new Locator(driver, by.text("Tap me"));
  await loc.tap(); // the label node's own centre
  await loc.tap({ clickableAncestor: true }); // the clickable parent's centre
  assert.deepEqual(driver.taps, [
    { x: 100, y: 100 },
    { x: 150, y: 200 },
  ]);
});

test("Locator.fill focuses the field (tap) then types via the driver", async () => {
  const driver = new FakeDriver('<node content-desc="Email" bounds="[0,0][200,80]" />');
  await new Locator(driver, by.label("Email")).fill("a@b.com");
  assert.deepEqual(driver.taps, [{ x: 100, y: 40 }]); // focused
  assert.deepEqual(driver.typed, ["a@b.com"]); // then typed
});

test("Locator.fill throws when the driver has no text input", async () => {
  const noInput: Driver = {
    platform: "android",
    source: async () => '<node content-desc="Email" bounds="[0,0][200,80]" />',
    pause: async () => {},
    tapAt: async () => {},
  };
  await assert.rejects(() => new Locator(noInput, by.label("Email")).fill("x"), /text input/);
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
