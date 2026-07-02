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
  readonly presses: Array<{
    x: number;
    y: number;
    duration: number | undefined;
    pointerId: string | undefined;
  }> = [];
  readonly cleared: string[] = [];
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

  async pressAt(
    x: number,
    y: number,
    options: { duration?: number; pointerId?: string } = {},
  ): Promise<void> {
    this.presses.push({ x, y, duration: options.duration, pointerId: options.pointerId });
  }

  async typeText(text: string): Promise<void> {
    this.typed.push(text);
  }

  async clearText(): Promise<void> {
    this.cleared.push("focused");
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

test("Locator.tap prefers the driver's native node click before coordinate fallback", async () => {
  const driver = new FakeDriver('<node label="Log in" bounds="[0,0][120,60]" />');
  driver.platform = "ios";
  const clicked: string[] = [];
  (driver as unknown as Driver & { clickNode: NonNullable<Driver["clickNode"]> }).clickNode = async (
    node,
  ) => {
    clicked.push(node);
    return true;
  };

  await new Locator(driver, by.text("Log in")).tap();

  assert.equal(clicked.length, 1);
  assert.deepEqual(driver.taps, []);
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

test("by.role with name matches the role and accessible name together", async () => {
  let checked = false;
  const driver: Driver = {
    platform: "android",
    async source() {
      return (
        '<node class="android.widget.TextView" content-desc="Accept Agreement" bounds="[100,0][400,80]" />' +
        `<node class="android.widget.CheckBox" content-desc="Accept Agreement" checked="${checked}" bounds="[0,0][80,80]" />`
      );
    },
    async pause() {},
    async tapAt() {
      checked = !checked;
    },
  };

  const AcceptAgreementCheckbox = new Locator(driver, by.role("checkbox", { name: /Accept Agreement/ }));
  assert.equal(await new Locator(driver, by.role("button", { name: /Accept Agreement/ })).isVisible(), false);

  await AcceptAgreementCheckbox.check();
  await expect(AcceptAgreementCheckbox).toBeChecked();
});

test("by.role with name matches Android Compose controls labelled by child nodes", async () => {
  const driver = new FakeDriver(
    '<node class="android.view.View" clickable="true" enabled="false" bounds="[0,0][300,80]">' +
      '<node class="android.widget.TextView" text="Search" clickable="false" enabled="true" bounds="[120,20][180,60]" />' +
      '<node class="android.widget.Button" text="" clickable="false" enabled="true" bounds="[0,0][300,80]" />' +
      "</node>" +
      '<node class="android.widget.EditText" text="" bounds="[0,120][300,200]">' +
      '<node class="android.view.View" content-desc="Email address" bounds="[0,120][300,200]" />' +
      "</node>",
  );

  const SearchButton = new Locator(driver, by.role("button", { name: "Search" }));
  const EmailAddressField = new Locator(driver, by.role("textfield", { name: /email address/i }));

  assert.equal(await SearchButton.isVisible(), true);
  await expect(SearchButton).toBeDisabled();
  assert.equal((await SearchButton.bounds())?.centerY, 40);

  assert.equal(await EmailAddressField.isVisible(), true);
  assert.equal((await EmailAddressField.bounds())?.centerY, 160);
});

test("by.role with name tolerates tiny iOS label geometry drift", async () => {
  const driver = new FakeDriver(
    '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="name@work-email.com" x="56" y="708" width="179" height="22" />' +
      '<XCUIElementTypeTextField type="XCUIElementTypeTextField" label="" x="56" y="706" width="309" height="23" />',
  );
  driver.platform = "ios";

  const SsoProviderSearchField = new Locator(driver, by.role("textfield", { name: /name@work-email\.com/i }));

  assert.equal(await SsoProviderSearchField.isVisible(), true);
  assert.equal((await SsoProviderSearchField.bounds())?.centerY, 718);
});

test("by.role with name does not borrow unrelated visible text outside the control bounds", async () => {
  const driver = new FakeDriver(
    '<node class="android.widget.TextView" text="Search" bounds="[400,0][520,80]" />' +
      '<node class="android.widget.Button" text="" bounds="[0,0][300,80]" />',
  );

  const SearchButton = new Locator(driver, by.role("button", { name: "Search" }));
  assert.equal(await SearchButton.isVisible(), false);
});

test("by.role with name does not borrow an overlapping label when the control already has a name", async () => {
  const driver = new FakeDriver(
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="home_speaker_option" label="I&apos;ll speak" x="48" y="438" width="297" height="159" />' +
      '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Turn on audio" name="Turn on audio" label="Turn on audio" x="128" y="569" width="137" height="27" />' +
      '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Turn on audio" label="Turn on audio" x="16" y="720" width="361" height="41" />',
  );
  driver.platform = "ios";

  const TurnOnAudioButton = new Locator(driver, by.role("button", { name: "Turn on audio" }));

  assert.equal((await TurnOnAudioButton.bounds())?.centerY, 741);
});

test("iOS checkbox-like buttons can be checked through semantic checkbox locators", async () => {
  let checked = false;
  const driver: Driver = {
    platform: "ios",
    async source() {
      const label = checked ? "Checkbox is checked" : "Checkbox is unchecked";
      const value = checked ? "1" : "0";
      const traits = checked ? "Selected, Button" : "Button";
      return (
        `<XCUIElementTypeButton type="XCUIElementTypeButton" name="acc_agreement_checkbox" label="${label}" value="${value}" traits="${traits}" x="44" y="720" width="22" height="23" />` +
        '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="I have read and agreed to the Terms of Service" x="78" y="720" width="260" height="40" />'
      );
    },
    async pause() {},
    async tapAt() {
      checked = !checked;
    },
  };

  const AcceptAgreementCheckbox = new Locator(driver, by.role("checkbox")).near(
    new Locator(driver, by.text(/I have read and agreed/)),
  );

  assert.equal(await new Locator(driver, by.role("checkbox")).count(), 1);
  await expect(AcceptAgreementCheckbox).not.toBeChecked();

  await AcceptAgreementCheckbox.check();
  await expect(AcceptAgreementCheckbox).toBeChecked();
});

test("iOS unlabeled square agreement buttons resolve as checkboxes near visible copy", async () => {
  let checked = false;
  const taps: Array<{ x: number; y: number }> = [];
  const driver: Driver = {
    platform: "ios",
    async source() {
      const checkbox = checked
        ? '<XCUIElementTypeButton type="XCUIElementTypeButton" value="1" label="Selected" enabled="true" visible="true" x="43" y="704" width="24" height="25" traits="Selected, Button" />'
        : '<XCUIElementTypeButton type="XCUIElementTypeButton" enabled="true" visible="true" x="43" y="704" width="24" height="25" />';
      return (
        checkbox +
        '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="I have read and agreed to the" x="78" y="705" width="156" height="15" />' +
        '<XCUIElementTypeButton type="XCUIElementTypeButton" label="Terms of Service" x="237" y="705" width="92" height="15" />' +
        '<XCUIElementTypeButton type="XCUIElementTypeButton" label="Privacy Policy" x="102" y="723" width="76" height="15" />' +
        '<XCUIElementTypeButton type="XCUIElementTypeButton" label="Accept" enabled="false" x="44" y="754" width="305" height="40" />'
      );
    },
    async pause() {},
    async tapAt(x, y) {
      taps.push({ x, y });
      checked = true;
    },
  };

  const AcceptAgreementCheckbox = new Locator(driver, by.role("checkbox")).near(
    new Locator(driver, by.text(/I have read and agreed/)),
  );

  assert.equal(await new Locator(driver, by.role("checkbox")).count(), 1);
  await AcceptAgreementCheckbox.check();
  await expect(AcceptAgreementCheckbox).toBeChecked();
  assert.deepEqual(taps, [{ x: 55, y: 717 }]);
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

test("toBeDisabled reads the clickable ancestor state for a label inside a disabled button", async () => {
  const driver = new FakeDriver(
    '<node clickable="true" enabled="false" bounds="[0,0][300,80]">' +
      '<node text="Search" clickable="false" enabled="true" bounds="[120,20][180,60]" />' +
      '<node class="android.widget.Button" clickable="false" enabled="true" bounds="[0,0][300,80]" />' +
      "</node>",
  );
  const SearchButton = new Locator(driver, by.text("Search"));
  await expect(SearchButton).toBeDisabled();
  await expect(SearchButton).not.toBeEnabled();
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

test("Locator.press presses and releases the locator centre through the driver", async () => {
  const driver = new FakeDriver('<node text="Hold mic" bounds="[10,20][110,120]" />');
  const loc = new Locator(driver, by.text("Hold mic"));

  await loc.press({ duration: 1500, pointerId: "push-to-talk-finger" });

  assert.deepEqual(driver.presses, [{ x: 60, y: 70, duration: 1500, pointerId: "push-to-talk-finger" }]);
  assert.deepEqual(driver.taps, []);
});

test("Locator.press({ clickableAncestor: true }) presses the clickable parent", async () => {
  const source =
    '<node clickable="true" bounds="[0,0][300,400]">' +
    '<node text="Hold me" clickable="false" bounds="[50,90][150,110]" /></node>';
  const driver = new FakeDriver(source);

  await new Locator(driver, by.text("Hold me")).press({ clickableAncestor: true });

  assert.deepEqual(driver.presses, [{ x: 150, y: 200, duration: undefined, pointerId: undefined }]);
});

test("Locator.fill focuses, clears, then types replacement text via the driver", async () => {
  const driver = new FakeDriver('<node content-desc="Email" bounds="[0,0][200,80]" />');
  await new Locator(driver, by.label("Email")).fill("a@b.com");
  assert.deepEqual(driver.taps, [{ x: 100, y: 40 }]); // focused
  assert.deepEqual(driver.cleared, ["focused"]); // existing text replaced
  assert.deepEqual(driver.typed, ["a@b.com"]); // then typed
});

test("Locator.clear focuses the field then clears via the driver", async () => {
  const driver = new FakeDriver('<node content-desc="Email" bounds="[0,0][200,80]" />');
  await new Locator(driver, by.label("Email")).clear();
  assert.deepEqual(driver.taps, [{ x: 100, y: 40 }]);
  assert.deepEqual(driver.cleared, ["focused"]);
  assert.deepEqual(driver.typed, []);
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

test("Locator.fill throws when the driver cannot clear focused text", async () => {
  const noClear: Driver = {
    platform: "android",
    source: async () => '<node content-desc="Email" bounds="[0,0][200,80]" />',
    pause: async () => {},
    tapAt: async () => {},
    typeText: async () => {},
  };
  await assert.rejects(() => new Locator(noClear, by.label("Email")).fill("x"), /focused text clearing/);
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

const SETTINGS_SCREEN =
  '<node text="Open info and settings" bounds="[0,0][200,50]" />' +
  '<node text="Sign out" bounds="[0,60][200,110]" />' +
  '<node text="Members (3)" bounds="[0,120][200,170]" />' +
  '<node text="Privacy policy" bounds="[0,180][200,230]" />';

test("waitFor timeout names the nearest on-screen labels, nearest first", async () => {
  const driver = new FakeDriver(SETTINGS_SCREEN);
  await assert.rejects(
    () => new Locator(driver, by.text("Open info settings")).waitFor({ timeout: 10, interval: 5 }),
    (error: Error) => {
      assert.match(
        error.message,
        /did not become visible within 10ms — did you mean "Open info and settings"/,
      );
      assert.doesNotMatch(error.message, /Members \(3\)/); // capped at the closest few
      return true;
    },
  );
});

test("tap timeout carries the did-you-mean hint", async () => {
  const driver = new FakeDriver(SETTINGS_SCREEN);
  await assert.rejects(
    () => new Locator(driver, by.text("Sign Out")).tap({ timeout: 10, interval: 5 }),
    /was not found to tap within 10ms — did you mean "Sign out"/,
  );
});

test("timeout errors stay unchanged when the screen offers no candidates", async () => {
  const driver = new FakeDriver("");
  await assert.rejects(
    () => new Locator(driver, by.text("Anything")).waitFor({ timeout: 10, interval: 5 }),
    (error: Error) => {
      assert.match(error.message, /did not become visible within 10ms$/);
      return true;
    },
  );
});

test("id selectors suggest nearby ids, not visible labels", async () => {
  const driver = new FakeDriver(
    '<node resource-id="com.app:id/login_btn" text="Log in" bounds="[0,0][100,50]" />',
  );
  await assert.rejects(
    () => new Locator(driver, by.id("com.app:id/login_button")).waitFor({ timeout: 10, interval: 5 }),
    /did you mean "com\.app:id\/login_btn"/,
  );
});

test("role selectors rank candidates by the requested name", async () => {
  const driver = new FakeDriver(
    '<node class="android.widget.CheckBox" text="Accept agreement" bounds="[0,0][100,50]" />',
  );
  await assert.rejects(
    () =>
      new Locator(driver, by.role("checkbox", { name: "Accept agreements" })).waitFor({
        timeout: 10,
        interval: 5,
      }),
    /did you mean "Accept agreement"/,
  );
});

test("expect(locator).toBeVisible failure includes the did-you-mean hint when the element is absent", async () => {
  const driver = new FakeDriver('<node text="Welcome back!" bounds="[0,0][100,50]" />');
  await assert.rejects(
    () => expect(new Locator(driver, by.text("Welcome back"))).toBeVisible({ timeout: 10, interval: 5 }),
    /assertion not met — did you mean "Welcome back!"/,
  );
});

test("negated expect failures never carry a did-you-mean hint", async () => {
  const driver = new FakeDriver(SETTLED);
  await assert.rejects(
    () => expect(new Locator(driver, by.desc("Sign out"))).not.toBeVisible({ timeout: 10, interval: 5 }),
    (error: Error) => {
      assert.doesNotMatch(error.message, /did you mean/);
      return true;
    },
  );
});

test("Locator.fill routes through the driver's atomic element setValue when available", async () => {
  const driver = new FakeDriver(
    '<node class="android.widget.EditText" resource-id="com.app:id/session" text="old" bounds="[0,0][200,60]" />',
  );
  const setValues: Array<{ node: string; text: string }> = [];
  (driver as unknown as Driver & { setValueOnNode: NonNullable<Driver["setValueOnNode"]> }).setValueOnNode =
    async (node, text) => {
      setValues.push({ node, text });
      return true;
    };

  await new Locator(driver, by.role("textfield")).fill("new value");

  assert.equal(setValues.length, 1);
  assert.match(setValues[0]?.node ?? "", /com\.app:id\/session/);
  assert.equal(setValues[0]?.text, "new value");
  // Atomic path replaces the whole focus-tap + clear + type dance.
  assert.deepEqual(driver.taps, []);
  assert.deepEqual(driver.cleared, []);
  assert.deepEqual(driver.typed, []);
});

test("Locator.fill falls back to focus-tap + clear + type when native setValue cannot resolve", async () => {
  const driver = new FakeDriver('<node text="Email" bounds="[0,0][200,60]" />');
  (driver as unknown as Driver & { setValueOnNode: NonNullable<Driver["setValueOnNode"]> }).setValueOnNode =
    async () => false;

  await new Locator(driver, by.text("Email")).fill("me@example.com");

  assert.deepEqual(driver.taps, [{ x: 100, y: 30 }]);
  assert.deepEqual(driver.cleared, ["focused"]);
  assert.deepEqual(driver.typed, ["me@example.com"]);
});

test("Locator.clear uses the atomic element path with an empty value", async () => {
  const driver = new FakeDriver('<node text="Session ID" bounds="[0,0][200,60]" />');
  const setValues: Array<{ node: string; text: string }> = [];
  (driver as unknown as Driver & { setValueOnNode: NonNullable<Driver["setValueOnNode"]> }).setValueOnNode =
    async (node, text) => {
      setValues.push({ node, text });
      return true;
    };

  await new Locator(driver, by.text("Session ID")).clear();

  assert.deepEqual(
    setValues.map((call) => call.text),
    [""],
  );
  assert.deepEqual(driver.taps, []);
  assert.deepEqual(driver.cleared, []);
});

test("Locator.fill works without keyboard input when the driver sets values natively", async () => {
  const setValues: string[] = [];
  const driver: Driver = {
    platform: "android",
    async source() {
      return '<node text="Passcode" bounds="[0,0][200,60]" />';
    },
    async pause() {},
    async tapAt() {},
    async setValueOnNode(_node, text) {
      setValues.push(text);
      return true;
    },
  };

  await new Locator(driver, by.text("Passcode")).fill("123456");

  assert.deepEqual(setValues, ["123456"]);
});
