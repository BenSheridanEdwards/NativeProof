import { browser } from "@wdio/globals";
import { adbDump } from "./adb.js";
import { captureScreenshot, captureState, captureText } from "./evidence.js";
import { tapAt } from "./gestures.js";
import { type Bounds, boundsForContentDesc } from "./source.js";
import { waitAndClick } from "./wait.js";

/**
 * Base class for all Screen Objects.
 *
 * Encapsulates the "try a semantic selector, fall back to a source-bounds
 * coordinate tap" pattern that native Compose/SwiftUI surfaces require, plus
 * evidence shortcuts. App screen objects extend this; nothing here is app-specific,
 * so it travels with the framework as a standalone, reusable core.
 */
export abstract class Screen {
  /** Current Appium page source (best-effort; empty string on driver error). */
  async source(): Promise<string> {
    return browser.getPageSource().catch(() => "");
  }

  async isPresent(pattern: RegExp): Promise<boolean> {
    return pattern.test(await this.source());
  }

  /**
   * Assert a pattern is visible via the Appium source, falling back to a raw
   * `adb uiautomator dump` for nodes hidden from the Appium accessibility tree.
   */
  async assertVisible(
    pattern: RegExp,
    message: string,
  ): Promise<{ source: string; sourceKind: "appium" | "adb-uiautomator" }> {
    const source = await this.source();
    if (pattern.test(source)) return { source, sourceKind: "appium" };
    const dump = adbDump();
    if (pattern.test(dump)) return { source: dump, sourceKind: "adb-uiautomator" };
    throw new Error(`${message}; source was: ${source}\n--- adb ---\n${dump}`);
  }

  /**
   * Tap an Android control by `content-desc`, falling back to a coordinate tap
   * computed from the page-source bounds when the accessibility node is present
   * but not directly clickable.
   */
  async tapContentDesc(contentDesc: string, timeout = 10000): Promise<void> {
    try {
      await waitAndClick(`android=new UiSelector().description("${contentDesc}")`, timeout);
    } catch {
      const bounds = boundsForContentDesc(await this.source(), contentDesc);
      if (!bounds) {
        throw new Error(`Expected to find a control with content-desc "${contentDesc}"`);
      }
      await tapAt(bounds.centerX, bounds.centerY);
    }
  }

  protected async tapBounds(bounds: Bounds): Promise<void> {
    await tapAt(bounds.centerX, bounds.centerY);
  }

  /** Dismiss an open bottom sheet via the system back affordance. */
  async dismissBottomSheet(): Promise<void> {
    await browser.back().catch(async () => {
      await tapAt(540, 850);
    });
    await browser.pause(1000);
  }

  // Evidence shortcuts ------------------------------------------------------
  protected captureScreenshot = captureScreenshot;
  protected captureText = captureText;
  protected captureState = captureState;
}
