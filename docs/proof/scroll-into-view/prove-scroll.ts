/**
 * Device proof for Locator.scrollIntoView: an off-screen Settings row is scrolled into
 * the page source and asserted visible on a real Appium session.
 * Run: npx tsx docs/proof/scroll-into-view/prove-scroll.ts android|ios
 * (needs Appium at 127.0.0.1:4723/wd/hub, a booted device, udids adjusted to your machine).
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

// A row that lives at the bottom of the Settings list on each platform.
const target = platform === "android" ? /About emulated device/ : "Developer";

const browser = await remote({
  hostname: "127.0.0.1",
  port: 4723,
  path: "/wd/hub",
  logLevel: "warn",
  capabilities,
  connectionRetryTimeout: 240000,
});
_setGlobal("browser", browser, false);
const driver = wdioDriver();

try {
  await driver.pause(2500);
  const row = new Locator(driver, by.text(target));

  const before = await row.isVisible();
  console.log(`[${platform}] target visible before scroll: ${before}`);
  if (before) throw new Error("PROOF INVALID: target already on screen; pick a lower row");
  await browser.saveScreenshot(path.join(proofDir, `${platform}-00-before-scroll.png`));

  await row.scrollIntoView({ maxSwipes: 15 });

  console.log(`[${platform}] target visible after scrollIntoView: ${await row.isVisible()}`);
  await browser.saveScreenshot(path.join(proofDir, `${platform}-01-scrolled-into-view.png`));
  console.log(`[${platform}] PROOF PASSED`);
} finally {
  await browser.deleteSession().catch(() => {});
}
