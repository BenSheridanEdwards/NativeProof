import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { _setGlobal } from "@wdio/globals";
import { iosExactNodeXPath, iosNodeCanUseNativeClick, wdioDriver } from "../src/driver.js";

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
