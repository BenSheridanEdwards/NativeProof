import { browser } from "@wdio/globals";
import { tapAt } from "./gestures.js";

/**
 * The minimal device contract the locator and expect layers drive.
 *
 * A thin seam over the real engine (WebdriverIO/Appium) — the Playwright `Page`
 * equivalent — that keeps locators and matchers testable without a device: tests
 * supply a fake `Driver`, production uses {@link wdioDriver}.
 */
export type Platform = "android" | "ios";

export interface Driver {
  /** The platform under test — selects how a cross-platform selector maps to source. */
  readonly platform: Platform;
  /** Current page-source XML (best-effort; empty string on driver error). */
  source(): Promise<string>;
  /** Idle for the given milliseconds; also used as the poll interval by the waits. */
  pause(ms: number): Promise<void>;
  /** Tap an absolute screen coordinate. */
  tapAt(x: number, y: number): Promise<void>;
  /**
   * Type into the currently focused element (keyboard input). Optional: drivers that
   * cannot type leave it undefined, and {@link Locator.fill} throws a clear error.
   */
  typeText?(text: string): Promise<void>;
  /**
   * Clear the currently focused text element. Optional: drivers that cannot clear focused
   * input leave it undefined, and {@link Locator.fill} / {@link Locator.clear} throw clearly.
   */
  clearText?(): Promise<void>;
}

/** A {@link Driver} backed by the live WebdriverIO/Appium session. */
export function wdioDriver(): Driver {
  return {
    get platform(): Platform {
      return browser.isAndroid ? "android" : "ios";
    },
    source: () =>
      browser.getPageSource().catch((err: unknown) => {
        // Don't let a dead/unreachable session masquerade as "element not visible";
        // surface it so a timeout's cause is visible, then degrade to empty source.
        console.warn(`[nativeproof] getPageSource failed: ${err}`);
        return "";
      }),
    pause: (ms: number) => browser.pause(ms),
    tapAt: (x: number, y: number) => tapAt(x, y),
    typeText: (text: string) => browser.keys(text),
    clearText: async () => {
      const activeElement = await browser.getActiveElement();
      const elementId = elementIdFromProtocolResponse(activeElement);
      if (!elementId) {
        throw new Error("Could not resolve the active text element to clear it");
      }
      await browser.elementClear(elementId);
    },
  };
}

function elementIdFromProtocolResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  const elementId = record["element-6066-11e4-a52e-4f735466cecf"] ?? record.ELEMENT;
  if (typeof elementId === "string") return elementId;

  const value = record.value;
  if (!value || typeof value !== "object") return null;
  const valueRecord = value as Record<string, unknown>;
  const valueElementId = valueRecord["element-6066-11e4-a52e-4f735466cecf"] ?? valueRecord.ELEMENT;
  return typeof valueElementId === "string" ? valueElementId : null;
}
