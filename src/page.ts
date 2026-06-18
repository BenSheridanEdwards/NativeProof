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
   * Match by accessible name. Native accessibility trees don't expose web-style roles
   * reliably, so `role` is advisory and the dependable signal is the name (the element's
   * accessibility label). Pass `{ name }` — a string for exact match, or a RegExp.
   */
  getByRole(role: string, options: { name: string | RegExp } & WaitOptions): Locator;
}

export function page(driver: Driver): Page {
  return {
    locator: (selector, options = {}) => locator(driver, selector, options),
    getByText: (text, options = {}) => locator(driver, by.text(text), options),
    getByTestId: (testId, options = {}) => locator(driver, by.testId(testId), options),
    getByLabel: (label, options = {}) => locator(driver, by.label(label), options),
    getById: (id, options = {}) => locator(driver, by.id(id), options),
    getByRole: (role, options) => {
      const { name, ...wait } = options;
      if (!name) {
        throw new Error(
          `getByRole(${JSON.stringify(role)}) needs { name } on native — it matches the accessible label`,
        );
      }
      return locator(driver, by.label(name), wait);
    },
  };
}
