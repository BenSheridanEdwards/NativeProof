import { $, browser } from "@wdio/globals";

/**
 * Selector waiting helpers built on the WebdriverIO runner globals.
 *
 * `waitForAnyDisplayed` resolves the first of several candidate selectors to
 * appear — essential on screens that render one of multiple possible states
 * (e.g. an onboarding "Later" sheet vs. the role-selection home).
 */

export type DisplayedMatch = {
  selector: string;
  element: ReturnType<typeof $>;
};

export async function waitAndClick(selector: string, timeout = 10000): Promise<void> {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  await element.click();
}

export async function waitForAnyDisplayed(selectors: string[], timeout = 30000): Promise<DisplayedMatch> {
  let matched: DisplayedMatch | undefined;
  await browser.waitUntil(
    async () => {
      for (const selector of selectors) {
        const element = $(selector);
        const displayed = await element.isDisplayed().catch(() => false);
        if (displayed) {
          matched = { selector, element };
          return true;
        }
      }
      return false;
    },
    {
      timeout,
      interval: 500,
      timeoutMsg: `None of the selectors became displayed within ${timeout}ms: ${selectors.join(", ")}`,
    },
  );
  // waitUntil only resolves once the predicate set `matched`.
  return matched as DisplayedMatch;
}
