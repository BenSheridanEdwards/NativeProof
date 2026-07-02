/**
 * Device proof for PR #63: Locator.fill/clear route through Driver.setValueOnNode
 * (atomic element setValue) on a real Appium session, and the value is REPLACED,
 * not appended. Run: npx tsx docs/proof/atomic-fill/prove-atomic-fill.ts android|ios
 * (needs a running Appium at 127.0.0.1:4723/wd/hub, a booted device per platform,
 * and the udids below adjusted to your machine).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { _setGlobal } from "@wdio/globals";
import { remote } from "webdriverio";
import { wdioDriver } from "../../../src/driver.js";
import { by, Locator } from "../../../src/locator.js";

const platform = process.argv[2];
const proofDir = path.dirname(new URL(import.meta.url).pathname);
mkdirSync(proofDir, { recursive: true });

const capabilities =
  platform === "android"
    ? {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:udid": "emulator-5554",
        "appium:appPackage": "com.android.settings",
        "appium:appActivity": ".Settings",
        "appium:appWaitActivity": "*",
        "appium:forceAppLaunch": true,
        "appium:newCommandTimeout": 240,
      }
    : {
        platformName: "iOS",
        "appium:automationName": "XCUITest",
        "appium:udid": "BAC6BC3E-07B0-4CA0-9712-BA299C8B5370",
        "appium:bundleId": "com.apple.Preferences",
        "appium:newCommandTimeout": 240,
        "appium:wdaLaunchTimeout": 240000,
      };

function fail(message: string): never {
  throw new Error(`PROOF FAILED: ${message}`);
}

const browser = await remote({
  hostname: "127.0.0.1",
  port: 4723,
  path: "/wd/hub",
  logLevel: "warn",
  capabilities,
  waitforTimeout: 3000,
  connectionRetryTimeout: 240000,
});
_setGlobal("browser", browser, false);

const driver = wdioDriver();
// Instrument the atomic path so the proof shows WHICH path fill()/clear() took.
const atomicCalls: Array<{ text: string; handled: boolean }> = [];
const realSetValue = driver.setValueOnNode?.bind(driver);
if (!realSetValue) fail("wdioDriver has no setValueOnNode");
driver.setValueOnNode = async (node, text) => {
  const handled = await realSetValue(node, text);
  atomicCalls.push({ text, handled });
  console.log(`  setValueOnNode(${JSON.stringify(text)}) -> ${handled}`);
  return handled;
};

const shot = async (name: string) => {
  await browser.saveScreenshot(path.join(proofDir, `${platform}-${name}.png`));
  console.log(`  screenshot: ${platform}-${name}.png`);
};

/** The current value of the settings search field, read from the raw page source. */
const fieldValueInSource = async (): Promise<string> => {
  const source = await driver.source();
  const attr = platform === "android" ? "text" : "value";
  const nodes =
    platform === "android"
      ? source.match(/<[^>]*class="android\.widget\.EditText"[^>]*>/g)
      : source.match(/<[^>]*type="XCUIElementTypeSearchField"[^>]*>/g);
  const node = nodes?.[0] ?? "";
  return new RegExp(`\\b${attr}="([^"]*)"`).exec(node)?.[1] ?? "";
};

try {
  console.log(`[${platform}] session started, opening the Settings search field`);
  await driver.pause(2500);

  let field: Locator;
  if (platform === "android") {
    await new Locator(driver, by.text(/Search settings/i)).tap({
      clickableAncestor: true,
      timeout: 20000,
    });
    field = new Locator(driver, by.role("textfield"));
  } else {
    // The Settings home screen exposes name="Search" on both the row label (first in
    // document order) and the real XCUIElementTypeSearchField — target the field.
    field = new Locator(driver, by.desc("Search")).nth(1);
  }
  await field.waitFor({ timeout: 20000 });
  await shot("00-search-field");

  console.log(`[${platform}] fill("hello world")`);
  await field.fill("hello world", { timeout: 20000 });
  await driver.pause(1500);
  const first = await fieldValueInSource();
  console.log(`  field value: ${JSON.stringify(first)}`);
  if (!first.includes("hello world")) fail(`expected "hello world" in field, got ${JSON.stringify(first)}`);
  await shot("01-filled-hello-world");

  console.log(`[${platform}] fill("atomic") — must REPLACE, not append`);
  await field.fill("atomic", { timeout: 20000 });
  await driver.pause(1500);
  const second = await fieldValueInSource();
  console.log(`  field value: ${JSON.stringify(second)}`);
  if (second.includes("hello")) fail(`old text survived the refill: ${JSON.stringify(second)}`);
  if (!second.includes("atomic")) fail(`expected "atomic" in field, got ${JSON.stringify(second)}`);
  await shot("02-refilled-atomic-replaced");

  console.log(`[${platform}] clear()`);
  await field.clear({ timeout: 20000 });
  await driver.pause(1500);
  const cleared = await fieldValueInSource();
  console.log(`  field value: ${JSON.stringify(cleared)}`);
  if (cleared.includes("atomic")) fail(`clear() left text behind: ${JSON.stringify(cleared)}`);
  await shot("03-cleared");

  const atomicHandled = atomicCalls.filter((call) => call.handled).length;
  console.log(
    `[${platform}] RESULT: ${atomicCalls.length} setValueOnNode calls, ${atomicHandled} handled atomically`,
  );
  if (atomicHandled < 3) fail(`expected fill+fill+clear on the atomic path, got ${atomicHandled}`);
  console.log(`[${platform}] PROOF PASSED`);
} finally {
  await browser.deleteSession().catch(() => {});
}
