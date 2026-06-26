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

test("by.text matches a content-desc label by RegExp even when an empty text= precedes it", async () => {
  // Compose nodes often carry both attributes: an empty text="" first, the real label in
  // content-desc. The RegExp path must test every alternation attribute, not just the first.
  const driver = new FakeDriver('<node text="" content-desc="Add to cart" bounds="[10,10][110,60]" />');
  const loc = new Locator(driver, by.text(/add to cart/i));
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

test("resolves iOS x/y/width/height geometry (no Android `bounds`) for visibility and tap", async () => {
  // iOS XCUITest exposes geometry as separate x/y/width/height attributes, not Android's
  // bounds="[x1,y1][x2,y2]". Without nodeBounds the element has null bounds and tap() finds nothing.
  const driver = new FakeDriver(
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Submit" label="Submit" enabled="true" visible="true" x="41" y="412" width="311" height="41" />',
  );
  driver.platform = "ios";
  const submit = new Locator(driver, by.label("Submit"));
  assert.equal(await submit.isVisible(), true);
  const b = await submit.bounds();
  assert.ok(b);
  assert.equal(b.centerX, 197); // 41 + 311/2
  assert.equal(b.centerY, 433); // 412 + 41/2
  await submit.tap();
  assert.deepEqual(driver.taps, [{ x: 197, y: 433 }]);
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

test("nth/first/last and count select among multiple matches", async () => {
  const driver = new FakeDriver(
    '<node text="Item" bounds="[0,0][100,50]" />' +
      '<node text="Item" bounds="[0,60][100,110]" />' +
      '<node text="Item" bounds="[0,120][100,170]" />',
  );
  const items = new Locator(driver, by.text("Item"));
  assert.equal(await items.count(), 3);
  await expect(items).toHaveCount(3);
  assert.equal((await items.first().bounds())?.centerY, 25);
  assert.equal((await items.nth(1).bounds())?.centerY, 85);
  assert.equal((await items.last().bounds())?.centerY, 145);
  await items.nth(1).tap();
  assert.deepEqual(driver.taps, [{ x: 50, y: 85 }]);
});

test("by.role matches elements by class (Android), with checked state and count", async () => {
  const driver = new FakeDriver(
    '<node class="android.widget.CheckBox" content-desc="Notifications" checked="true" bounds="[0,0][80,80]" />' +
      '<node class="android.widget.TextView" text="Notifications" bounds="[100,0][400,80]" />' +
      '<node class="android.widget.CheckBox" content-desc="Sounds" checked="false" bounds="[0,100][80,180]" />',
  );
  const checkboxes = new Locator(driver, by.role("checkbox"));
  assert.equal(await checkboxes.count(), 2); // both CheckBox nodes, not the TextView
  assert.equal(await checkboxes.first().isChecked(), true);
  assert.equal(await checkboxes.nth(1).isChecked(), false);
  assert.equal(await new Locator(driver, by.role("button")).isVisible(), false); // none present
});

test("toBeEnabled / toBeDisabled read the enabled attribute", async () => {
  const driver = new FakeDriver(
    '<node content-desc="Submit" enabled="false" bounds="[0,0][100,40]" />' +
      '<node content-desc="Cancel" enabled="true" bounds="[0,60][100,100]" />',
  );
  await expect(new Locator(driver, by.label("Submit"))).toBeDisabled();
  await expect(new Locator(driver, by.label("Submit"))).not.toBeEnabled();
  await expect(new Locator(driver, by.label("Cancel"))).toBeEnabled();
  await expect(new Locator(driver, by.label("Cancel"))).not.toBeDisabled();
});

test("by.role throws a helpful error on an unknown role", async () => {
  const driver = new FakeDriver("<node class='Whatever' />");
  await assert.rejects(() => new Locator(driver, by.role("slider")).isVisible(), /Unknown role "slider"/);
});

test("near() resolves the match nearest an anchor — the checkbox in a label's row", async () => {
  const driver = new FakeDriver(
    '<node text="Wi-Fi" bounds="[0,0][300,80]" />' +
      '<node class="android.widget.CheckBox" checked="false" bounds="[320,0][380,80]" />' + // Wi-Fi row
      '<node text="Bluetooth" bounds="[0,100][300,180]" />' +
      '<node class="android.widget.CheckBox" checked="true" bounds="[320,100][380,180]" />', // Bluetooth row
  );
  const checkbox = by.role("checkbox");
  const wifiBox = new Locator(driver, checkbox).near(new Locator(driver, by.text("Wi-Fi")));
  const btBox = new Locator(driver, checkbox).near(new Locator(driver, by.text("Bluetooth")));
  assert.equal(await wifiBox.isChecked(), false); // the Wi-Fi-row checkbox, nearest "Wi-Fi"
  assert.equal(await btBox.isChecked(), true); // the Bluetooth-row checkbox, nearest "Bluetooth"
  await wifiBox.tap();
  assert.deepEqual(driver.taps, [{ x: 350, y: 40 }]); // tapped the Wi-Fi-row checkbox centre

  // maxDistance drops a too-far match → resolves to nothing
  const none = new Locator(driver, checkbox).near(new Locator(driver, by.text("Wi-Fi")), { maxDistance: 10 });
  assert.equal(await none.isVisible(), false);
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
