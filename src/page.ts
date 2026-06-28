import type { Driver } from "./driver.js";
import { by, type Locator, locator, type Selector, type WaitOptions } from "./locator.js";

/**
 * Playwright-style `getBy*` ergonomics over a {@link Driver}, so selectors are
 * discovered, not inferred. `page(driver).getByText("Submit")` returns a {@link Locator}
 * and you never spell out which native attribute backs it. Every `getBy*` takes a string
 * (exact match) or a RegExp (`getByText(/Save( draft)?/)`).
 */
export interface Page {
  /** Escape hatch: a locator from a raw selector. */
  locator(selector: Selector, options?: WaitOptions): Locator;
  getByText(text: string | RegExp, options?: WaitOptions): Locator;
  getByTestId(testId: string | RegExp, options?: WaitOptions): Locator;
  getByLabel(label: string | RegExp, options?: WaitOptions): Locator;
  getById(id: string | RegExp, options?: WaitOptions): Locator;
  /**
   * Match by role. With `{ name }`, matches the element role and accessible name together.
   * Without a name, matches by element class/type
   * (`checkbox`, `switch`, `button`, `textfield`, `image`) — e.g. `getByRole("checkbox")`.
   */
  getByRole(role: string, options?: { name?: string | RegExp } & WaitOptions): Locator;
}

export function page(driver: Driver): Page {
  return {
    locator: (selector, options = {}) => locator(driver, selector, options),
    getByText: (text, options = {}) => locator(driver, by.text(text), options),
    getByTestId: (testId, options = {}) => locator(driver, by.testId(testId), options),
    getByLabel: (label, options = {}) => locator(driver, by.label(label), options),
    getById: (id, options = {}) => locator(driver, by.id(id), options),
    getByRole: (role, options = {}) => {
      const { name, ...wait } = options;
      if (name === "") {
        throw new Error(
          `getByRole(${JSON.stringify(role)}, { name: "" }) — name must be non-empty; omit it to match by role`,
        );
      }
      return locator(driver, by.role(role, name === undefined ? undefined : { name }), wait);
    },
  };
}
