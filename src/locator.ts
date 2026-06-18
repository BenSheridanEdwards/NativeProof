import type { Driver, Platform } from "./driver.js";
import {
  attributeMatches,
  type Bounds,
  boundsForAttribute,
  decodeXmlEntities,
  encodeXmlEntities,
  escapeRegExp,
  nodeForAttribute,
  smallestClickableAncestorBounds,
} from "./source.js";

/**
 * Cross-platform locators — the reusable heart of the framework.
 *
 * A {@link Locator} is a lazy, awaitable handle to an element addressed by a
 * platform-agnostic selector (`by.text` / `by.desc` / `by.id`), with built-in
 * waiting and a source-bounds coordinate-tap fallback. It is the Playwright
 * `Locator` equivalent and the thing that lets `expect(locator).toShow(...)` exist.
 */

/** A cross-platform element selector. */
export type Selector =
  | { readonly by: "text"; readonly value: string | RegExp }
  | { readonly by: "desc"; readonly value: string | RegExp }
  | { readonly by: "id"; readonly value: string | RegExp }
  | { readonly by: "testId"; readonly value: string | RegExp }
  | { readonly by: "label"; readonly value: string | RegExp };

/**
 * Build selectors Playwright-style. The cross-platform attribute each maps to is resolved
 * per platform (see {@link attributeFor}), so you never have to know whether it's a
 * `content-desc` or a `name`: `by.text("Submit")`, `by.testId("login-button")`,
 * `by.label("Sign out")`, `by.id("message-list")`. Each accepts a string (exact match) or
 * a RegExp (`by.text(/Save( draft)?/)`), tested against the element's decoded value.
 */
export const by = {
  text: (value: string | RegExp): Selector => ({ by: "text", value }),
  desc: (value: string | RegExp): Selector => ({ by: "desc", value }),
  id: (value: string | RegExp): Selector => ({ by: "id", value }),
  /** The app's test id (Android `resource-id` / Compose testTag, iOS accessibilityIdentifier). */
  testId: (value: string | RegExp): Selector => ({ by: "testId", value }),
  /** The accessibility label (Android `content-desc`, iOS `label`). */
  label: (value: string | RegExp): Selector => ({ by: "label", value }),
} as const;

export function describeSelector(selector: Selector): string {
  const value = selector.value instanceof RegExp ? String(selector.value) : JSON.stringify(selector.value);
  return `by.${selector.by}(${value})`;
}

/**
 * The page-source attribute a selector resolves to on each platform. `text` is an
 * alternation, because a visible label surfaces as `text` OR `content-desc` on Android
 * (Compose) and as `label` OR `value` on iOS — so `getByText` finds a label wherever
 * the toolkit put it, not just the node's own `text` attribute.
 */
function attributeFor(selector: Selector, platform: Platform): string {
  const android = {
    text: "(?:text|content-desc)",
    desc: "content-desc",
    id: "resource-id",
    testId: "resource-id",
    label: "content-desc",
  } as const;
  const ios = { text: "(?:label|value)", desc: "name", id: "name", testId: "name", label: "label" } as const;
  return (platform === "ios" ? ios : android)[selector.by];
}

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  /** Sleep awaited between polls; defaults to a real timer. The locator injects the driver's pause. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TapOptions extends WaitOptions {
  /**
   * Tap the smallest `clickable="true"` ancestor that contains the matched node, rather
   * than the node itself. Compose/SwiftUI often expose a label on a non-clickable child;
   * this taps the real touch target around it.
   */
  clickableAncestor?: boolean;
}

const DEFAULTS = { timeout: 10_000, interval: 250 };
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `produce` until `done(value)` holds or the timeout elapses, returning the
 * last value either way (callers decide what an unmet condition means). The interval
 * is awaited via `options.sleep` — a real timer by default, the driver's `pause` when
 * a locator drives it — so a fake clock can control test timing. No device required.
 */
export async function waitUntil<T>(
  produce: () => Promise<T>,
  done: (value: T) => boolean,
  options: WaitOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? DEFAULTS.timeout;
  const interval = options.interval ?? DEFAULTS.interval;
  const sleep = options.sleep ?? realSleep;
  const deadline = Date.now() + timeout;
  let value = await produce();
  while (!done(value) && Date.now() < deadline) {
    await sleep(interval);
    value = await produce();
  }
  return value;
}

export class Locator {
  constructor(
    readonly driver: Driver,
    readonly selector: Selector,
    private readonly options: WaitOptions = {},
  ) {}

  private attribute(): string {
    return attributeFor(this.selector, this.driver.platform);
  }

  /** True if the selector matches a node in the current source. */
  async isVisible(): Promise<boolean> {
    return attributeMatches(await this.driver.source(), this.attribute(), this.selector.value);
  }

  /** Bounds of the matched node in the current source, or null if absent. */
  async bounds(): Promise<Bounds | null> {
    return boundsForAttribute(await this.driver.source(), this.attribute(), this.selector.value);
  }

  /** The matched node's own visible text, or null if the node is absent. */
  async textContent(): Promise<string | null> {
    const source = await this.driver.source();
    const node = nodeForAttribute(source, this.attribute(), this.selector.value);
    if (!node) return null;
    // A visible label can live in either of two attributes per platform, in the same
    // precedence `attributeFor` uses (iOS label→value, Android text→content-desc). Prefer
    // the first NON-empty one, so a node like `value="" label="Submit"` reads "Submit",
    // falling back to the first present (possibly empty) attribute.
    const attrs = this.driver.platform === "ios" ? ["label", "value"] : ["text", "content-desc"];
    const present = attrs
      .map((attr) => new RegExp(`${attr}="([^"]*)"`).exec(node)?.[1])
      .filter((v): v is string => v !== undefined);
    const raw = present.find((v) => v !== "") ?? present[0];
    return raw === undefined ? null : decodeXmlEntities(raw);
  }

  /** True if the selector is present AND `text` appears in the source. */
  async shows(text: string | RegExp): Promise<boolean> {
    const source = await this.driver.source();
    if (!attributeMatches(source, this.attribute(), this.selector.value)) return false;
    const pattern = typeof text === "string" ? new RegExp(escapeRegExp(encodeXmlEntities(text))) : text;
    return pattern.test(source);
  }

  /** Wait until the selector is visible; throws on timeout. */
  async waitFor(options: WaitOptions = {}): Promise<void> {
    const opts: WaitOptions = { ...this.options, ...options, sleep: (ms) => this.driver.pause(ms) };
    const visible = await waitUntil(
      () => this.isVisible(),
      (v) => v,
      opts,
    );
    if (!visible) {
      throw new Error(
        `${describeSelector(this.selector)} did not become visible within ${opts.timeout ?? DEFAULTS.timeout}ms`,
      );
    }
  }

  /** Wait for the element, then tap its centre (a source-bounds coordinate tap). */
  async tap(options: TapOptions = {}): Promise<void> {
    const opts: WaitOptions = { ...this.options, ...options, sleep: (ms) => this.driver.pause(ms) };
    const bounds = await waitUntil(
      () => this.bounds(),
      (b) => b !== null,
      opts,
    );
    if (!bounds) {
      throw new Error(
        `${describeSelector(this.selector)} was not found to tap within ${opts.timeout ?? DEFAULTS.timeout}ms`,
      );
    }
    const target = options.clickableAncestor
      ? smallestClickableAncestorBounds(await this.driver.source(), bounds)
      : bounds;
    await this.driver.tapAt(target.centerX, target.centerY);
  }

  /**
   * Focus the field (tap it) and type `text`. Requires a driver with text input
   * ({@link Driver.typeText}); throws a clear error otherwise. Types into the focused
   * field — it does not clear existing content first.
   */
  async fill(text: string, options: WaitOptions = {}): Promise<void> {
    if (!this.driver.typeText) {
      throw new Error(
        `${describeSelector(this.selector)}.fill(...) needs a driver that supports text input (Driver.typeText)`,
      );
    }
    await this.tap(options);
    await this.driver.typeText(text);
  }

  /** True if the matched node is a checked checkbox/switch (`checked="true"`). */
  async isChecked(): Promise<boolean> {
    const node = nodeForAttribute(await this.driver.source(), this.attribute(), this.selector.value);
    return node !== null && /\bchecked="true"/.test(node);
  }

  /** Tap to bring a checkbox/switch to checked; a no-op if it already is. */
  async check(options: WaitOptions = {}): Promise<void> {
    await this.setChecked(true, options);
  }

  /** Tap to bring a checkbox/switch to unchecked; a no-op if it already is. */
  async uncheck(options: WaitOptions = {}): Promise<void> {
    await this.setChecked(false, options);
  }

  private async setChecked(desired: boolean, options: WaitOptions): Promise<void> {
    if ((await this.isChecked()) === desired) return;
    await this.tap(options);
    const opts: WaitOptions = { ...this.options, ...options, sleep: (ms) => this.driver.pause(ms) };
    const settled = await waitUntil(
      () => this.isChecked(),
      (value) => value === desired,
      opts,
    );
    if (settled !== desired) {
      const state = desired ? "checked" : "unchecked";
      throw new Error(
        `${describeSelector(this.selector)} did not become ${state} within ${opts.timeout ?? DEFAULTS.timeout}ms`,
      );
    }
  }
}

/** Convenience factory: `locator(driver, by.text("Submit"))`. */
export function locator(driver: Driver, selector: Selector, options: WaitOptions = {}): Locator {
  return new Locator(driver, selector, options);
}
