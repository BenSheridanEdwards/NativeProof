import type { Driver, Platform } from "./driver.js";
import { type Bounds, boundsForAttribute } from "./source.js";

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
  | { readonly by: "text"; readonly value: string }
  | { readonly by: "desc"; readonly value: string }
  | { readonly by: "id"; readonly value: string }
  | { readonly by: "testId"; readonly value: string }
  | { readonly by: "label"; readonly value: string };

/**
 * Build selectors Playwright-style. The cross-platform attribute each maps to is resolved
 * per platform (see {@link attributeFor}), so you never have to know whether it's a
 * `content-desc` or a `name`: `by.text("Submit")`, `by.testId("login-button")`,
 * `by.label("Sign out")`, `by.id("message-list")`.
 */
export const by = {
  text: (value: string): Selector => ({ by: "text", value }),
  desc: (value: string): Selector => ({ by: "desc", value }),
  id: (value: string): Selector => ({ by: "id", value }),
  /** The app's test id (Android `resource-id` / Compose testTag, iOS accessibilityIdentifier). */
  testId: (value: string): Selector => ({ by: "testId", value }),
  /** The accessibility label (Android `content-desc`, iOS `label`). */
  label: (value: string): Selector => ({ by: "label", value }),
} as const;

export function describeSelector(selector: Selector): string {
  return `by.${selector.by}(${JSON.stringify(selector.value)})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The page-source attribute a selector resolves to on each platform. */
function attributeFor(selector: Selector, platform: Platform): string {
  const android = {
    text: "text",
    desc: "content-desc",
    id: "resource-id",
    testId: "resource-id",
    label: "content-desc",
  } as const;
  const ios = { text: "label", desc: "name", id: "name", testId: "name", label: "label" } as const;
  return (platform === "ios" ? ios : android)[selector.by];
}

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  /** Sleep awaited between polls; defaults to a real timer. The locator injects the driver's pause. */
  sleep?: (ms: number) => Promise<void>;
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

  private presencePattern(): RegExp {
    return new RegExp(`${this.attribute()}="${escapeRegExp(this.selector.value)}"`);
  }

  /** True if the selector matches a node in the current source. */
  async isVisible(): Promise<boolean> {
    return this.presencePattern().test(await this.driver.source());
  }

  /** Bounds of the matched node in the current source, or null if absent. */
  async bounds(): Promise<Bounds | null> {
    return boundsForAttribute(await this.driver.source(), this.attribute(), this.selector.value);
  }

  /** The matched node's own visible text, or null if the node is absent. */
  async textContent(): Promise<string | null> {
    const source = await this.driver.source();
    const node = new RegExp(`<[^>]*${this.attribute()}="${escapeRegExp(this.selector.value)}"[^>]*>`).exec(
      source,
    )?.[0];
    if (!node) return null;
    const textAttr = this.driver.platform === "ios" ? "value|label" : "text";
    return new RegExp(`(?:${textAttr})="([^"]*)"`).exec(node)?.[1] ?? null;
  }

  /** True if the selector is present AND `text` appears in the source. */
  async shows(text: string | RegExp): Promise<boolean> {
    const source = await this.driver.source();
    if (!this.presencePattern().test(source)) return false;
    const pattern = typeof text === "string" ? new RegExp(escapeRegExp(text)) : text;
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
  async tap(options: WaitOptions = {}): Promise<void> {
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
    await this.driver.tapAt(bounds.centerX, bounds.centerY);
  }
}

/** Convenience factory: `locator(driver, by.text("Submit"))`. */
export function locator(driver: Driver, selector: Selector, options: WaitOptions = {}): Locator {
  return new Locator(driver, selector, options);
}
