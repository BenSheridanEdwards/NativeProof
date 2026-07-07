import type { Driver, Platform } from "./driver.js";
import {
  attrPattern,
  type Bounds,
  decodeXmlEntities,
  deGlobal,
  escapeRegExp,
  nodesForAttribute,
  nodesForRole,
  parseNodeBounds,
  smallestClickableAncestorNode,
  sourceExtent,
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
  | { readonly by: "label"; readonly value: string | RegExp }
  | {
      readonly by: "role";
      readonly value: string;
      readonly name?: string | RegExp;
      /** Keep only elements whose checked state matches (see {@link Locator.isChecked}). */
      readonly checked?: boolean;
      /** Keep only elements whose own `enabled` attribute matches (no ancestor walk). */
      readonly disabled?: boolean;
      /**
       * Keep only elements the toolkit reports on screen — iOS `visible="true"`, Android
       * `displayed="true"`. Native trees often carry offscreen or shadow duplicates of the
       * same role (a hidden SwiftUI text field behind the focused one); this picks the live one.
       */
      readonly visible?: boolean;
    };

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
  /** A semantic role, matched by element class/type — `checkbox`, `switch`, `button`, `textfield`, `image`. */
  role: (
    value: string,
    options: { name?: string | RegExp; checked?: boolean; disabled?: boolean; visible?: boolean } = {},
  ): Selector => {
    const selector: { -readonly [K in keyof Extract<Selector, { by: "role" }>]?: unknown } = {
      by: "role",
      value,
    };
    if (options.name !== undefined) selector.name = options.name;
    if (options.checked !== undefined) selector.checked = options.checked;
    if (options.disabled !== undefined) selector.disabled = options.disabled;
    if (options.visible !== undefined) selector.visible = options.visible;
    return selector as Selector;
  },
} as const;

export function describeSelector(selector: Selector): string {
  const value = selector.value instanceof RegExp ? String(selector.value) : JSON.stringify(selector.value);
  if (selector.by === "role") {
    const options: string[] = [];
    if (selector.name !== undefined) {
      options.push(
        `name: ${selector.name instanceof RegExp ? String(selector.name) : JSON.stringify(selector.name)}`,
      );
    }
    if (selector.checked !== undefined) options.push(`checked: ${selector.checked}`);
    if (selector.disabled !== undefined) options.push(`disabled: ${selector.disabled}`);
    if (selector.visible !== undefined) options.push(`visible: ${selector.visible}`);
    return options.length > 0 ? `by.role(${value}, { ${options.join(", ")} })` : `by.role(${value})`;
  }
  return `by.${selector.by}(${value})`;
}

/**
 * The page-source attribute a selector resolves to on each platform. `text` is an
 * alternation, because a visible label surfaces as `text` OR `content-desc` on Android
 * (Compose) and as `label` OR `value` on iOS — so `getByText` finds a label wherever
 * the toolkit put it, not just the node's own `text` attribute.
 */
function attributeFor(selector: Selector, platform: Platform): string {
  if (selector.by === "role") {
    throw new Error("role selectors match by element class/type, not a single attribute");
  }
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

export type ScrollDirection = "down" | "up" | "left" | "right";

export interface ScrollOptions extends WaitOptions {
  /** Which way the VIEW moves — "down" reveals content below (the finger swipes up). */
  direction?: ScrollDirection;
  /** How many swipes to attempt before giving up. */
  maxSwipes?: number;
}

export interface PressOptions extends TapOptions {
  /** How long to hold the press before releasing, in milliseconds. */
  duration?: number;
  /** Stable pointer id for Appium/WebDriver action logs. */
  pointerId?: string;
}

const DEFAULTS = { timeout: 10_000, interval: 250 };
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_SUGGESTIONS = 3;

/** Levenshtein distance — error-path only, candidate strings are short screen labels. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The string a selector is hunting for, used to rank did-you-mean candidates. */
function selectorTarget(selector: Selector): string {
  const value = selector.by === "role" ? (selector.name ?? selector.value) : selector.value;
  return value instanceof RegExp ? value.source : value;
}

function formatSuggestions(values: readonly string[]): string {
  if (values.length === 0) return "";
  return ` — did you mean ${values.map((value) => JSON.stringify(value)).join(", ")}?`;
}

/**
 * A swipe across the middle 40% of the viewport that moves the view toward `direction` —
 * scrolling "down" drags the finger from 70% to 30% height, so content below scrolls in.
 * Short of the edges to avoid triggering system edge gestures.
 */
function swipeVector(
  direction: ScrollDirection,
  extent: Bounds,
): { fromX: number; fromY: number; toX: number; toY: number } {
  const x = (ratio: number) => Math.round(extent.x1 + extent.width * ratio);
  const y = (ratio: number) => Math.round(extent.y1 + extent.height * ratio);
  switch (direction) {
    case "down":
      return { fromX: extent.centerX, fromY: y(0.7), toX: extent.centerX, toY: y(0.3) };
    case "up":
      return { fromX: extent.centerX, fromY: y(0.3), toX: extent.centerX, toY: y(0.7) };
    case "right":
      return { fromX: x(0.7), fromY: extent.centerY, toX: x(0.3), toY: extent.centerY };
    case "left":
      return { fromX: x(0.3), fromY: extent.centerY, toX: x(0.7), toY: extent.centerY };
  }
}

/** Element classes/types that accept text — the targets fill()/clear() expect to hit. */
function looksLikeTextInput(node: string, platform: Platform): boolean {
  if (platform === "ios") {
    return /\btype="XCUIElementType(?:TextField|SecureTextField|SearchField|TextView)"/.test(node);
  }
  return /(?:EditText|AutoCompleteTextView|SearchView)/.test(nodeAttribute(node, "class") ?? "");
}

function nodeAttribute(node: string, attribute: string): string | undefined {
  const value = new RegExp(`${attrPattern(attribute)}([^"]*)"`).exec(node)?.[1];
  return value === undefined ? undefined : decodeXmlEntities(value);
}

function nodeIsChecked(node: string): boolean {
  const checked = nodeAttribute(node, "checked");
  if (checked !== undefined) return /^(?:true|1)$/i.test(checked);

  const value = nodeAttribute(node, "value");
  if (value !== undefined) {
    if (/^(?:true|1|checked|selected)$/i.test(value)) return true;
    if (/^(?:false|0|unchecked|unselected)$/i.test(value)) return false;
  }

  const traits = nodeAttribute(node, "traits");
  if (traits && /\b(?:selected|checked)\b/i.test(traits)) return true;

  const label = nodeAttribute(node, "label");
  if (label) {
    if (/\bunchecked\b/i.test(label)) return false;
    if (/\bchecked\b/i.test(label)) return true;
  }

  return false;
}

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
    /** When set, the locator resolves to the nth match (negative counts from the end). */
    private readonly index?: number,
    /** When set, matches are ordered by proximity to the anchor (and filtered by maxDistance). */
    private readonly proximity?: { anchor: Locator; maxDistance?: number },
  ) {}

  /**
   * The wait options (timeout/interval) this locator was constructed with. Its own
   * interactions merge these into every wait; exposing them lets `expect(locator)`
   * honour the same per-locator timeout instead of falling back to the default.
   */
  get waitOptions(): WaitOptions {
    return this.options;
  }

  private attribute(): string {
    return attributeFor(this.selector, this.driver.platform);
  }

  /** Node tags this selector matches in `source`, in document order (role- or attribute-based). */
  private nodesIn(source: string): string[] {
    if (this.selector.by !== "role") {
      return nodesForAttribute(source, this.attribute(), this.selector.value);
    }
    const { checked, disabled, visible } = this.selector;
    let nodes = nodesForRole(source, this.selector.value, this.driver.platform, this.selector.name);
    if (checked !== undefined) nodes = nodes.filter((node) => nodeIsChecked(node) === checked);
    if (disabled !== undefined) {
      const disabledPattern = new RegExp(`${attrPattern("enabled")}false"`);
      nodes = nodes.filter((node) => disabledPattern.test(node) === disabled);
    }
    if (visible !== undefined) {
      // iOS reports on-screen state as visible="true", Android as displayed="true".
      const visiblePattern = new RegExp(
        `${attrPattern(this.driver.platform === "ios" ? "visible" : "displayed")}true"`,
      );
      nodes = nodes.filter((node) => visiblePattern.test(node) === visible);
    }
    return nodes;
  }

  /**
   * All node tags this selector matches in the current source — document order, or, when a
   * `near` anchor is set, ordered nearest-first by bounds-centre distance (filtered by maxDistance).
   */
  private async matchedNodes(): Promise<string[]> {
    return this.matchedNodesIn(await this.driver.source());
  }

  /**
   * Matches in one `source` snapshot — the anchor of a `near()` locator is located in the
   * SAME snapshot as the candidates. Resolving them from two fetches paired elements across
   * frames: under animation the anchor moved between reads and the wrong row's control won.
   */
  private matchedNodesIn(source: string): string[] {
    const nodes = this.nodesIn(source);
    if (!this.proximity) return nodes;
    const anchorLocator = this.proximity.anchor;
    const anchorNode = anchorLocator.pick(anchorLocator.matchedNodesIn(source));
    const anchor = anchorNode ? parseNodeBounds(anchorNode) : null;
    if (!anchor) return [];
    const { maxDistance } = this.proximity;
    return nodes
      .map((node) => ({ node, bounds: parseNodeBounds(node) }))
      .filter((entry): entry is { node: string; bounds: Bounds } => entry.bounds !== null)
      .map((entry) => ({
        node: entry.node,
        distance: Math.hypot(entry.bounds.centerX - anchor.centerX, entry.bounds.centerY - anchor.centerY),
      }))
      .filter((entry) => maxDistance === undefined || entry.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.node);
  }

  /** The single node this locator resolves to (the nth match, or the first when unindexed). */
  private pick(nodes: string[]): string | null {
    if (this.index === undefined) return nodes[0] ?? null;
    const at = this.index < 0 ? nodes.length + this.index : this.index;
    return nodes[at] ?? null;
  }

  /** A locator scoped to the nth match (0-based; negative counts from the end). */
  nth(index: number): Locator {
    return new Locator(this.driver, this.selector, this.options, index, this.proximity);
  }

  /**
   * Scope to the match nearest `anchor` (by bounds-centre distance) — the relative locator for
   * native: `getByRole("checkbox").near(getByText("Wi-Fi"))` is the checkbox in the Wi-Fi row.
   * `maxDistance` (px) drops matches farther than that, so an absent control resolves to nothing.
   */
  near(anchor: Locator, options: { maxDistance?: number } = {}): Locator {
    const proximity =
      options.maxDistance === undefined ? { anchor } : { anchor, maxDistance: options.maxDistance };
    return new Locator(this.driver, this.selector, this.options, this.index, proximity);
  }

  /** A locator scoped to the first match. */
  first(): Locator {
    return this.nth(0);
  }

  /** A locator scoped to the last match. */
  last(): Locator {
    return this.nth(-1);
  }

  /** How many elements currently match the selector. */
  async count(): Promise<number> {
    return (await this.matchedNodes()).length;
  }

  /** True if the selector matches a node in the current source. */
  async isVisible(): Promise<boolean> {
    return this.pick(await this.matchedNodes()) !== null;
  }

  /** Bounds of the matched node in the current source, or null if absent. */
  async bounds(): Promise<Bounds | null> {
    const node = this.pick(await this.matchedNodes());
    return node ? parseNodeBounds(node) : null;
  }

  /** The matched node's own visible text, or null if the node is absent. */
  async textContent(): Promise<string | null> {
    const node = this.pick(await this.matchedNodes());
    if (!node) return null;
    // A visible label can live in either of two attributes per platform, in the same
    // precedence `attributeFor` uses (iOS label→value, Android text→content-desc). Prefer
    // the first NON-empty one, so a node like `value="" label="Submit"` reads "Submit",
    // falling back to the first present (possibly empty) attribute.
    const attrs = this.driver.platform === "ios" ? ["label", "value"] : ["text", "content-desc"];
    const present = attrs
      .map((attr) => new RegExp(`${attrPattern(attr)}([^"]*)"`).exec(node)?.[1])
      .filter((v): v is string => v !== undefined);
    const raw = present.find((v) => v !== "") ?? present[0];
    return raw === undefined ? null : decodeXmlEntities(raw);
  }

  /**
   * The matched input's own content — iOS `value`, Android `text` — or null when the
   * node is absent. Unlike {@link Locator.textContent} there is no label fallback, so an
   * empty field reads "" rather than its label/placeholder.
   */
  async inputValue(): Promise<string | null> {
    const node = this.pick(await this.matchedNodes());
    if (!node) return null;
    return nodeAttribute(node, this.driver.platform === "ios" ? "value" : "text") ?? "";
  }

  /** True if the selector is present AND `text` appears in the source. */
  async shows(text: string | RegExp): Promise<boolean> {
    const source = await this.driver.source();
    if (this.pick(this.matchedNodesIn(source)) === null) return false;
    // Test against the DECODED source so the entity form the toolkit chose
    // (&apos; vs &#39; vs a literal apostrophe) never matters to the caller.
    const pattern = typeof text === "string" ? new RegExp(escapeRegExp(text)) : deGlobal(text);
    return pattern.test(decodeXmlEntities(source));
  }

  /**
   * The closest on-screen candidate values for this selector, nearest first — the
   * "did you mean" list appended to not-found errors so an exact-string mismatch
   * (capitalisation, trailing space, the real label) is visible without grepping
   * page-source XML. Reads the attributes the selector targets (labels for
   * text/label/desc/role, ids for id/testId). Never throws; empty on any failure.
   */
  async suggestions(): Promise<string[]> {
    try {
      const attribute =
        this.selector.by === "role"
          ? this.driver.platform === "ios"
            ? "(?:label|value)"
            : "(?:text|content-desc)"
          : this.attribute();
      const source = await this.driver.source();
      const values = [
        ...new Set(
          [...source.matchAll(new RegExp(`${attrPattern(attribute)}([^"]*)"`, "g"))]
            .map((match) => decodeXmlEntities(match[1] ?? ""))
            .filter((value) => value !== ""),
        ),
      ];
      const target = selectorTarget(this.selector).toLowerCase();
      return values
        .sort((a, b) => editDistance(a.toLowerCase(), target) - editDistance(b.toLowerCase(), target))
        .slice(0, MAX_SUGGESTIONS);
    } catch {
      return [];
    }
  }

  /** The did-you-mean suffix for a not-found error; empty when nothing is on screen. */
  async suggestionsHint(): Promise<string> {
    return formatSuggestions(await this.suggestions());
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
        `${describeSelector(this.selector)} did not become visible within ${opts.timeout ?? DEFAULTS.timeout}ms${await this.suggestionsHint()}`,
      );
    }
  }

  /**
   * Swipe until the element appears in the page source, Playwright's scrollIntoViewIfNeeded
   * for native: already-visible elements return immediately, otherwise the view scrolls
   * toward `direction` ("down" by default) up to `maxSwipes` times. Throws with the
   * did-you-mean candidates when the element never appears.
   */
  async scrollIntoView(options: ScrollOptions = {}): Promise<void> {
    if (!this.driver.swipe) {
      throw new Error(
        `${describeSelector(this.selector)}.scrollIntoView() needs a driver that supports swiping (Driver.swipe)`,
      );
    }
    const direction = options.direction ?? "down";
    const maxSwipes = options.maxSwipes ?? 10;
    for (let attempt = 0; attempt <= maxSwipes; attempt += 1) {
      const source = await this.driver.source();
      if (this.pick(this.matchedNodesIn(source)) !== null) return;
      if (attempt === maxSwipes) break;
      const extent = sourceExtent(source);
      if (!extent) break;
      const { fromX, fromY, toX, toY } = swipeVector(direction, extent);
      await this.driver.swipe(fromX, fromY, toX, toY);
      await this.driver.pause(options.interval ?? DEFAULTS.interval);
    }
    throw new Error(
      `${describeSelector(this.selector)} was not found after ${maxSwipes} ${direction} swipes${await this.suggestionsHint()}`,
    );
  }

  /** Wait for the element, then tap its centre (a source-bounds coordinate tap). */
  async tap(options: TapOptions = {}): Promise<void> {
    const target = await this.resolveTouchTarget(options);
    if (this.driver.clickNode && (await this.driver.clickNode(target.node))) return;
    await this.driver.tapAt(target.bounds.centerX, target.bounds.centerY);
  }

  /** Wait for the element, press its centre, hold briefly, then release. */
  async press(options: PressOptions = {}): Promise<void> {
    if (!this.driver.pressAt) {
      throw new Error(`${describeSelector(this.selector)}.press(...) needs a driver that supports pressAt`);
    }
    const target = await this.resolveTouchTarget(options);
    const pressOptions: { duration?: number; pointerId?: string } = {};
    if (options.duration !== undefined) pressOptions.duration = options.duration;
    if (options.pointerId !== undefined) pressOptions.pointerId = options.pointerId;
    await this.driver.pressAt(target.bounds.centerX, target.bounds.centerY, pressOptions);
  }

  private async resolveTouchTarget(options: TapOptions = {}): Promise<{ node: string; bounds: Bounds }> {
    const opts: WaitOptions = { ...this.options, ...options, sleep: (ms) => this.driver.pause(ms) };
    const match = await waitUntil(
      async () => {
        // Carry the snapshot the node was matched in, so the clickable ancestor is
        // resolved from the SAME tree — a second fetch paired stale bounds with a new frame.
        const source = await this.driver.source();
        const node = this.pick(this.matchedNodesIn(source));
        const bounds = node ? parseNodeBounds(node) : null;
        return node && bounds ? { node, bounds, source } : null;
      },
      (value) => value !== null,
      opts,
    );
    if (!match) {
      throw new Error(
        `${describeSelector(this.selector)} was not found to tap within ${opts.timeout ?? DEFAULTS.timeout}ms${await this.suggestionsHint()}`,
      );
    }
    if (!options.clickableAncestor) return { node: match.node, bounds: match.bounds };
    const node = smallestClickableAncestorNode(match.source, match.bounds) ?? match.node;
    return { node, bounds: parseNodeBounds(node) ?? match.bounds };
  }

  /**
   * Set the matched node's value in one native element call when the driver can resolve
   * it ({@link Driver.setValueOnNode}); false means the caller must use the focused-input
   * fallback. Waits for the element either way.
   */
  private async trySetValueOnNode(text: string, options: WaitOptions): Promise<boolean> {
    if (!this.driver.setValueOnNode) return false;
    const target = await this.resolveTouchTarget(options);
    // WDA/UiAutomator2 can "succeed" at setting a value on a label without typing
    // anywhere (observed on-device), and the keyboard fallback types into whatever
    // has focus — both are silent no-ops. Warn, don't throw: custom controls can
    // legitimately accept text under unusual classes.
    if (!looksLikeTextInput(target.node, this.driver.platform)) {
      const kind =
        nodeAttribute(target.node, this.driver.platform === "ios" ? "type" : "class") ??
        "an element with no class/type";
      console.warn(
        `[nativeproof] ${describeSelector(this.selector)} matched ${kind}, which does not look like a text input — fill/clear may silently go nowhere. Target the field itself, e.g. getByRole("textfield").`,
      );
    }
    return this.driver.setValueOnNode(target.node, text);
  }

  /** Clear the field's text — atomically on the element when the driver can, else focus-tap + clear. */
  async clear(options: WaitOptions = {}): Promise<void> {
    if (await this.trySetValueOnNode("", options)) return;
    if (!this.driver.clearText) {
      throw new Error(
        `${describeSelector(this.selector)}.clear() needs a driver that supports focused text clearing (Driver.clearText)`,
      );
    }
    await this.tap(options);
    await this.driver.clearText();
  }

  /**
   * Replace the field's current value with `text`, Playwright-style. Prefers the driver's
   * atomic element path ({@link Driver.setValueOnNode} — clear + type in one native call),
   * falling back to focus-tap + {@link Driver.clearText} + {@link Driver.typeText};
   * throws a clear error when the driver supports neither.
   */
  async fill(text: string, options: WaitOptions = {}): Promise<void> {
    if (!this.driver.typeText && !this.driver.setValueOnNode) {
      throw new Error(
        `${describeSelector(this.selector)}.fill(...) needs a driver that supports text input (Driver.setValueOnNode or Driver.typeText)`,
      );
    }
    if (await this.trySetValueOnNode(text, options)) return;
    if (!this.driver.typeText) {
      throw new Error(
        `${describeSelector(this.selector)}.fill(...) could not set the value natively and the driver has no keyboard fallback (Driver.typeText)`,
      );
    }
    await this.clear(options);
    await this.driver.typeText(text);
  }

  /** True if the matched checkbox/switch/custom control is checked. */
  async isChecked(): Promise<boolean> {
    const node = this.pick(await this.matchedNodes());
    return node !== null && nodeIsChecked(node);
  }

  /** True if the matched node is present and not `enabled="false"` (matches Playwright's default-enabled). */
  async isEnabled(): Promise<boolean> {
    const node = await this.controlStateNode();
    return node !== null && !/\benabled="false"/.test(node);
  }

  /** True if the matched node is present and explicitly `enabled="false"`. */
  async isDisabled(): Promise<boolean> {
    const node = await this.controlStateNode();
    return node !== null && /\benabled="false"/.test(node);
  }

  private async controlStateNode(): Promise<string | null> {
    const source = await this.driver.source();
    const node = this.pick(this.matchedNodesIn(source));
    if (!node || new RegExp(`${attrPattern("clickable")}true"`).test(node)) return node;
    const bounds = parseNodeBounds(node);
    if (!bounds) return node;
    return smallestClickableAncestorNode(source, bounds) ?? node;
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
