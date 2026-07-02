import { browser } from "@wdio/globals";
import { tapAt } from "./gestures.js";
import { decodeXmlEntities } from "./source.js";

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
  /** Press an absolute screen coordinate, hold briefly, then release. */
  pressAt?(x: number, y: number, options?: { duration?: number; pointerId?: string }): Promise<void>;
  /** Click a matched native source node directly when the live driver can resolve it. */
  clickNode?(node: string): Promise<boolean>;
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
  /**
   * Replace a matched node's text with `text` in one native element call (clear + type,
   * atomic on both UiAutomator2 and XCUITest — no coordinate tap, no focus race). Optional:
   * return false when the node cannot be resolved to a live element, and
   * {@link Locator.fill} / {@link Locator.clear} fall back to focus-tap + keyboard input.
   */
  setValueOnNode?(node: string, text: string): Promise<boolean>;
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
    pressAt: async (x: number, y: number, options = {}) => {
      const duration = options.duration ?? 500;
      await browser.performActions([
        {
          type: "pointer",
          id: options.pointerId ?? "nativeproof-finger",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x, y },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
      await browser.releaseActions();
    },
    clickNode: async (node: string) => {
      if (browser.isAndroid || !iosNodeCanUseNativeClick(node)) return false;
      const exactSelector = iosExactNodeXPath(node);
      if (exactSelector) {
        try {
          await browser.$(exactSelector).click();
          return true;
        } catch {
          /* Fall back to accessibility id below. */
        }
      }
      const name =
        nodeAttribute(node, "name") ?? nodeAttribute(node, "label") ?? nodeAttribute(node, "value");
      if (!name) return false;
      try {
        await browser.$(`~${name}`).click();
        return true;
      } catch {
        return false;
      }
    },
    typeText: async (text: string) => {
      if (browser.isAndroid) {
        await browser.keys(text);
        return;
      }
      await browser.elementSendKeys(
        await activeElementId("Could not resolve the active text element to type into it"),
        text,
      );
    },
    clearText: async () => {
      await browser.elementClear(
        await activeElementId("Could not resolve the active text element to clear it"),
      );
    },
    setValueOnNode: async (node: string, text: string) => {
      const selector = exactNodeXPath(node, browser.isAndroid ? "android" : "ios");
      if (!selector) return false;
      try {
        await browser.$(selector).setValue(text);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function iosNodeCanUseNativeClick(node: string): boolean {
  return iOSNodeLooksClickable(node) && nodeAttribute(node, "visible") !== "false";
}

export function iosExactNodeXPath(node: string): string | null {
  return iOSNodeLooksClickable(node) ? exactNodeXPath(node, "ios") : null;
}

/**
 * An exact XPath for a matched page-source node — anchored on the element type (iOS) or
 * class (Android) and narrowed by every identifying attribute the node exposes, so the
 * live driver can resolve the very element the locator matched (native click, atomic
 * setValue). Null when the node lacks its anchor attribute.
 */
export function exactNodeXPath(node: string, platform: Platform): string | null {
  const attributes =
    platform === "ios"
      ? (["type", "name", "label", "value", "x", "y", "width", "height"] as const)
      : (["class", "resource-id", "text", "content-desc", "bounds"] as const);
  if (nodeAttribute(node, attributes[0]) === null) return null;
  const predicates: string[] = [];
  for (const attribute of attributes) {
    const value = nodeAttribute(node, attribute);
    if (value !== null) predicates.push(`@${attribute}=${xpathLiteral(value)}`);
  }
  return `//*[${predicates.join(" and ")}]`;
}

function nodeAttribute(node: string, name: string): string | null {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(node)?.[1];
  return value ? decodeXmlEntities(value) : null;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value
    .split("'")
    .flatMap((part, index) => (index === 0 ? [`'${part}'`] : [`"'"`, `'${part}'`]))
    .join(", ")})`;
}

function iOSNodeLooksClickable(node: string): boolean {
  return /\btype="XCUIElementType(?:Button|Switch|TextField|SecureTextField|Cell)"/.test(node);
}

async function activeElementId(errorMessage: string): Promise<string> {
  const activeElement = await browser.getActiveElement();
  const elementId = elementIdFromProtocolResponse(activeElement);
  if (!elementId) {
    throw new Error(errorMessage);
  }
  return elementId;
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
