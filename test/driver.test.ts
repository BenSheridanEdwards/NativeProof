import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { _setGlobal } from "@wdio/globals";
import * as driverModule from "../src/driver.js";
import { iosExactNodeXPath, iosNodeCanUseNativeClick, wdioDriver } from "../src/driver.js";
import { expect } from "../src/expect.js";
import { by, Locator } from "../src/locator.js";

const ELEMENT_ID = "element-6066-11e4-a52e-4f735466cecf";

type FakeBrowser = {
  isAndroid: boolean;
  pageSources: string[];
  pauses: number[];
  keyInputs: string[];
  clearedElements: string[];
  sentText: Array<{ elementId: string; text: string }>;
  activeElementResponse: unknown;
  getPageSource(): Promise<string>;
  pause(ms: number): Promise<void>;
  keys(text: string): Promise<void>;
  getActiveElement(): Promise<unknown>;
  elementClear(elementId: string): Promise<void>;
  elementSendKeys(elementId: string, text: string): Promise<void>;
  $?: (selector: string) => { setValue(text: string): Promise<void>; click(): Promise<void> };
};

function fakeBrowser(options: { isAndroid?: boolean; activeElementResponse?: unknown } = {}): FakeBrowser {
  return {
    isAndroid: options.isAndroid ?? false,
    pageSources: ["<source />"],
    pauses: [],
    keyInputs: [],
    clearedElements: [],
    sentText: [],
    activeElementResponse: options.activeElementResponse ?? { [ELEMENT_ID]: "focused-field" },
    async getPageSource() {
      return this.pageSources[0] ?? "";
    },
    async pause(ms: number) {
      this.pauses.push(ms);
    },
    async keys(text: string) {
      this.keyInputs.push(text);
    },
    async getActiveElement() {
      return this.activeElementResponse;
    },
    async elementClear(elementId: string) {
      this.clearedElements.push(elementId);
    },
    async elementSendKeys(elementId: string, text: string) {
      this.sentText.push({ elementId, text });
    },
  };
}

afterEach(() => {
  globalThis._wdioGlobals?.delete("browser");
});

test("iosNodeCanUseNativeClick rejects XCUITest-hidden controls so tap can fall back", () => {
  assert.equal(
    iosNodeCanUseNativeClick(
      '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Turn on audio" label="Turn on audio" visible="false" x="16" y="720" width="361" height="41"/>',
    ),
    false,
  );
});

test("iosExactNodeXPath keeps the matched button distinct from same-named text", () => {
  const selector = iosExactNodeXPath(
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Turn on audio" label="Turn on audio" enabled="true" visible="true" accessible="true" x="16" y="720" width="361" height="41" index="4" traits="Button"/>',
  );

  assert.equal(
    selector,
    "//*[@type='XCUIElementTypeButton' and @name='Turn on audio' and @label='Turn on audio' and @x='16' and @y='720' and @width='361' and @height='41']",
  );
});

test("iosExactNodeXPath escapes apostrophes in accessible names", () => {
  const selector = iosExactNodeXPath(
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Speaker&apos;s audio" label="Speaker&apos;s audio" x="1" y="2" width="3" height="4"/>',
  );

  assert.equal(
    selector,
    `//*[@type='XCUIElementTypeButton' and @name=concat('Speaker', "'", 's audio') and @label=concat('Speaker', "'", 's audio') and @x='1' and @y='2' and @width='3' and @height='4']`,
  );
});

test("wdioDriver clickNode does not fall back to the first same-named iOS element", async () => {
  const browser = fakeBrowser();
  const selectors: string[] = [];
  browser.$ = (selector: string) => ({
    async setValue() {},
    async click() {
      selectors.push(selector);
      throw new Error("stale exact selector");
    },
  });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.ok(driver.clickNode);
  assert.equal(
    await driver.clickNode(
      '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Save" label="Save" x="50" y="200" width="80" height="44"/>',
    ),
    false,
  );
  assert.equal(selectors.length, 1);
  assert.match(selectors[0] ?? "", /^\/\//);
  assert.notEqual(selectors[0], "~Save");
});

test("wdioDriver types into the focused iOS element with Appium element send keys", async () => {
  const browser = fakeBrowser({ activeElementResponse: { [ELEMENT_ID]: "ios-field" } });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.equal(driver.platform, "ios");
  assert.ok(driver.typeText);
  await driver.typeText("123456");

  assert.deepEqual(browser.sentText, [{ elementId: "ios-field", text: "123456" }]);
  assert.deepEqual(browser.keyInputs, []);
});

test("wdioDriver keeps Android text input on browser keys", async () => {
  const browser = fakeBrowser({ isAndroid: true });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.equal(driver.platform, "android");
  assert.ok(driver.typeText);
  await driver.typeText("hello");

  assert.deepEqual(browser.keyInputs, ["hello"]);
  assert.deepEqual(browser.sentText, []);
});

test("wdioDriver clears the focused text element", async () => {
  const browser = fakeBrowser({
    activeElementResponse: { value: { [ELEMENT_ID]: "focused-field" } },
  });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.ok(driver.clearText);
  await driver.clearText();

  assert.deepEqual(browser.clearedElements, ["focused-field"]);
});

test("wdioDriver throws clearly when iOS focused text input cannot be resolved", async () => {
  const browser = fakeBrowser({ activeElementResponse: {} });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();
  const typeText = driver.typeText;

  assert.ok(typeText);
  await assert.rejects(() => typeText("hello"), /Could not resolve the active text element to type into it/);
  assert.deepEqual(browser.sentText, []);
  assert.deepEqual(browser.keyInputs, []);
});

test("exactNodeXPath anchors Android nodes on class and their identifying attributes", () => {
  const { exactNodeXPath } = driverModule;
  assert.equal(
    exactNodeXPath(
      '<android.widget.EditText class="android.widget.EditText" resource-id="com.app:id/session" text="old" bounds="[0,0][100,50]" />',
      "android",
    ),
    "//*[@class='android.widget.EditText' and @resource-id='com.app:id/session' and @text='old' and @bounds='[0,0][100,50]']",
  );
  assert.equal(exactNodeXPath('<node text="No class" />', "android"), null);
});

test("wdioDriver setValueOnNode resolves the exact element and sets the value atomically", async () => {
  const browser = fakeBrowser({ isAndroid: true });
  const calls: Array<{ selector: string; text: string }> = [];
  browser.$ = (selector: string) => ({
    async setValue(text: string) {
      calls.push({ selector, text });
    },
    async click() {},
  });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.ok(driver.setValueOnNode);
  const handled = await driver.setValueOnNode(
    '<android.widget.EditText class="android.widget.EditText" resource-id="com.app:id/session" bounds="[0,0][100,50]" />',
    "new text",
  );

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.selector ?? "", /@resource-id='com\.app:id\/session'/);
  assert.equal(calls[0]?.text, "new text");
});

test("wdioDriver setValueOnNode reports false when the node cannot become an element", async () => {
  const browser = fakeBrowser({ isAndroid: true });
  _setGlobal("browser", browser, false);
  const driver = wdioDriver();

  assert.ok(driver.setValueOnNode);
  // No class attribute: no exact selector, so the locator layer must fall back.
  assert.equal(await driver.setValueOnNode('<node text="Email" />', "x"), false);

  browser.$ = () => ({
    async setValue() {
      throw new Error("stale element");
    },
    async click() {},
  });
  assert.equal(
    await driver.setValueOnNode('<node class="android.widget.EditText" text="Email" />', "x"),
    false,
  );
});

test("exactNodeXPath must not read placeholderValue as the value predicate", () => {
  const selector = iosExactNodeXPath(
    '<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="session" label="Session" placeholderValue="Enter ID" value="abc" x="0" y="0" width="100" height="40"/>',
  );
  assert.ok(selector);
  assert.match(selector, /@value='abc'/);
  assert.doesNotMatch(selector, /Enter ID/);
});

for (const platform of ["ios", "android"] as const) {
  test(`wdioDriver ${platform} source failures cannot satisfy positive or negative assertions`, async () => {
    const browser = fakeBrowser({ isAndroid: platform === "android" });
    browser.getPageSource = async () => {
      throw new Error(`${platform} source unavailable`);
    };
    _setGlobal("browser", browser, false);
    const ready = new Locator(wdioDriver(), by.text("Ready"));

    await assert.rejects(
      () => expect(ready).toBeVisible({ timeout: 0 }),
      new RegExp(`${platform} source unavailable`),
    );
    await assert.rejects(
      () => expect(ready).not.toBeVisible({ timeout: 0 }),
      new RegExp(`${platform} source unavailable`),
    );
  });

  test(`wdioDriver ${platform} assertions recover before deciding presence or absence`, async () => {
    const present =
      platform === "ios"
        ? '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Ready" visible="true" x="0" y="0" width="10" height="10" />'
        : '<node class="android.widget.TextView" text="Ready" displayed="true" bounds="[0,0][10,10]" />';
    const browser = fakeBrowser({ isAndroid: platform === "android" });
    let reads = 0;
    browser.getPageSource = async () => {
      reads += 1;
      if (reads === 1) throw new Error(`${platform} transient source failure`);
      return present;
    };
    _setGlobal("browser", browser, false);
    const ready = new Locator(wdioDriver(), by.text("Ready"));

    await expect(ready).toBeVisible({ timeout: 50, interval: 1 });
    assert.equal(reads, 2);

    reads = 0;
    await assert.rejects(
      () => expect(ready).not.toBeVisible({ timeout: 5, interval: 1 }),
      /assertion not met/,
    );
    assert.ok(reads >= 2, `expected recovery read on ${platform}, got ${reads}`);

    reads = 0;
    browser.getPageSource = async () => {
      reads += 1;
      if (reads === 1) throw new Error(`${platform} transient source failure`);
      return "<hierarchy />";
    };
    await expect(ready).not.toBeVisible({ timeout: 50, interval: 1 });
    assert.equal(reads, 2);
  });

  test(`wdioDriver ${platform} distinguishes legitimate absence from source unavailability`, async () => {
    const browser = fakeBrowser({ isAndroid: platform === "android" });
    browser.getPageSource = async () => "<hierarchy />";
    _setGlobal("browser", browser, false);
    const ready = new Locator(wdioDriver(), by.text("Ready"));

    await expect(ready).not.toBeVisible({ timeout: 0 });
    await assert.rejects(() => expect(ready).toBeVisible({ timeout: 0 }), /assertion not met/);
  });
}
