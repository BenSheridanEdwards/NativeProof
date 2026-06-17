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

export function expect(target: Locator): LocatorAssertions;
export function expect(target: MockBackend): MockAssertions;
export function expect(target: Locator | MockBackend): LocatorAssertions | MockAssertions {
  return target instanceof Locator ? new LocatorExpectation(target) : new MockExpectation(target);
}
