import { isDeepStrictEqual } from "node:util";
import { describeSelector, Locator, type WaitOptions, waitUntil } from "./locator.js";
import { describeMatch, type FrameMatch, frameExists, type MockBackend } from "./mock.js";

/**
 * Playwright-style assertions with built-in auto-waiting — the "easy visibility"
 * layer. `expect(locator)` asserts UI state; `expect(mock)` asserts backend traffic.
 * Each matcher polls until the condition holds (or the timeout elapses), then asserts;
 * `.not` inverts it. No manual waits in the spec.
 */
export interface LocatorAssertions {
  readonly not: LocatorAssertions;
  /** The selector matches a node in the source. */
  toBeVisible(options?: WaitOptions): Promise<void>;
  /** The selector is present and `text` is shown on screen. */
  toShow(text: string | RegExp, options?: WaitOptions): Promise<void>;
  /** The matched node's own text equals/contains/matches `text`. */
  toHaveText(text: string | RegExp, options?: WaitOptions): Promise<void>;
}

export interface MockAssertions {
  readonly not: MockAssertions;
  /** The app sent a frame matching `match`. */
  toHaveSent(match: FrameMatch, options?: WaitOptions): Promise<void>;
  /** The app received a frame matching `match`. */
  toHaveReceived(match: FrameMatch, options?: WaitOptions): Promise<void>;
}

/**
 * Synchronous matchers for a plain value — for the non-UI assertions a spec still needs
 * (counts, ids, parsed payloads). UI/traffic matchers auto-wait and return promises;
 * these assert a value that is already known, so they run synchronously and `.not` inverts.
 */
export interface ValueAssertions<T> {
  readonly not: ValueAssertions<T>;
  /** Strict identity (`Object.is`). */
  toBe(expected: T): void;
  /** Deep structural equality. */
  toEqual(expected: T): void;
  /** Substring (for strings) or membership (for arrays). */
  toContain(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeDefined(): void;
  toBeNull(): void;
}

class LocatorExpectation implements LocatorAssertions {
  constructor(
    private readonly locator: Locator,
    private readonly negated: boolean = false,
  ) {}

  get not(): LocatorAssertions {
    return new LocatorExpectation(this.locator, !this.negated);
  }

  toBeVisible(options: WaitOptions = {}): Promise<void> {
    return this.check(() => this.locator.isVisible(), "be visible", options);
  }

  toShow(text: string | RegExp, options: WaitOptions = {}): Promise<void> {
    return this.check(() => this.locator.shows(text), `show ${JSON.stringify(String(text))}`, options);
  }

  toHaveText(text: string | RegExp, options: WaitOptions = {}): Promise<void> {
    return this.check(
      async () => {
        const content = await this.locator.textContent();
        if (content === null) return false;
        return typeof text === "string" ? content.includes(text) : text.test(content);
      },
      `have text ${JSON.stringify(String(text))}`,
      options,
    );
  }

  private async check(
    predicate: () => Promise<boolean>,
    description: string,
    options: WaitOptions,
  ): Promise<void> {
    const want = !this.negated;
    const opts: WaitOptions = { ...options, sleep: (ms) => this.locator.driver.pause(ms) };
    const settled = await waitUntil(predicate, (value) => value === want, opts);
    if (settled !== want) {
      const not = this.negated ? ".not" : "";
      throw new Error(
        `expect(${describeSelector(this.locator.selector)})${not}.to ${description} — assertion not met`,
      );
    }
  }
}

class MockExpectation implements MockAssertions {
  constructor(
    private readonly mock: MockBackend,
    private readonly negated: boolean = false,
  ) {}

  get not(): MockAssertions {
    return new MockExpectation(this.mock, !this.negated);
  }

  toHaveSent(match: FrameMatch, options: WaitOptions = {}): Promise<void> {
    return this.check("sent", match, options);
  }

  toHaveReceived(match: FrameMatch, options: WaitOptions = {}): Promise<void> {
    return this.check("received", match, options);
  }

  private async check(
    direction: "sent" | "received",
    match: FrameMatch,
    options: WaitOptions,
  ): Promise<void> {
    const want = !this.negated;
    const settled = await waitUntil(
      () => frameExists(this.mock, direction, match),
      (value) => value === want,
      options,
    );
    if (settled !== want) {
      const not = this.negated ? ".not" : "";
      const matcher = direction === "sent" ? "toHaveSent" : "toHaveReceived";
      throw new Error(`expect(mock)${not}.${matcher}(${describeMatch(match)}) — assertion not met`);
    }
  }
}

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

class ValueExpectation<T> implements ValueAssertions<T> {
  constructor(
    private readonly actual: T,
    private readonly negated: boolean = false,
  ) {}

  get not(): ValueAssertions<T> {
    return new ValueExpectation(this.actual, !this.negated);
  }

  toBe(expected: T): void {
    this.assert(Object.is(this.actual, expected), "toBe", describeValue(expected));
  }

  toEqual(expected: T): void {
    this.assert(isDeepStrictEqual(this.actual, expected), "toEqual", describeValue(expected));
  }

  toContain(expected: unknown): void {
    if (typeof this.actual !== "string" && !Array.isArray(this.actual)) {
      throw new TypeError(
        `expect(...).toContain(...) needs a string or array actual, got ${describeValue(this.actual)}`,
      );
    }
    const ok =
      typeof this.actual === "string"
        ? this.actual.includes(String(expected))
        : this.actual.includes(expected);
    this.assert(ok, "toContain", describeValue(expected));
  }

  toBeTruthy(): void {
    this.assert(Boolean(this.actual), "toBeTruthy");
  }

  toBeFalsy(): void {
    this.assert(!this.actual, "toBeFalsy");
  }

  toBeDefined(): void {
    this.assert(this.actual !== undefined, "toBeDefined");
  }

  toBeNull(): void {
    this.assert(this.actual === null, "toBeNull");
  }

  private assert(pass: boolean, matcher: string, expectedDesc = ""): void {
    const want = !this.negated;
    if (pass === want) return;
    const not = this.negated ? ".not" : "";
    throw new Error(
      `expect(${describeValue(this.actual)})${not}.${matcher}(${expectedDesc}) — assertion not met`,
    );
  }
}

/** Structural guard: a {@link MockBackend} is anything with `frames`/`route`/`stop`. */
function isMockBackend(target: unknown): target is MockBackend {
  return (
    typeof target === "object" &&
    target !== null &&
    typeof (target as MockBackend).frames === "function" &&
    typeof (target as MockBackend).route === "function" &&
    typeof (target as MockBackend).stop === "function"
  );
}

export function expect(target: Locator): LocatorAssertions;
export function expect(target: MockBackend): MockAssertions;
export function expect<T>(target: T): ValueAssertions<T>;
export function expect(target: unknown): LocatorAssertions | MockAssertions | ValueAssertions<unknown> {
  if (target instanceof Locator) return new LocatorExpectation(target);
  if (isMockBackend(target)) return new MockExpectation(target);
  return new ValueExpectation(target);
}
