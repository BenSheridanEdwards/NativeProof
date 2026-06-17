import { $, browser, driver, expect } from "@wdio/globals";

/**
 * Cross-platform text/selector layer.
 *
 * Resolves the same human-readable control name to the right native selector on
 * each platform (Android `UiSelector`, iOS predicate strings), preferring
 * accessibility names with visible-text fallbacks. This is the single place a
 * brittle selector becomes a stable automation id once the app teams add them.
 * App-agnostic framework core.
 */

const DEFAULT_WAIT_MS = 15_000;

export function exactText(text: string): string {
  if (driver.isAndroid) {
    return `android=new UiSelector().text(${JSON.stringify(text)})`;
  }
  const literal = iosLiteral(text);
  return `-ios predicate string:name == ${literal} OR label == ${literal} OR value == ${literal}`;
}

export function textContaining(text: string): string {
  if (driver.isAndroid) {
    return `android=new UiSelector().textContains(${JSON.stringify(text)})`;
  }
  const literal = iosLiteral(text);
  return `-ios predicate string:name CONTAINS ${literal} OR label CONTAINS ${literal} OR value CONTAINS ${literal}`;
}

export function accessibleName(text: string): string {
  return `~${text}`;
}

/** A trimmed, non-empty environment credential, or undefined when not configured. */
export function configuredCredential(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function firstTextInput(): string {
  if (driver.isAndroid) {
    return 'android=new UiSelector().className("android.widget.EditText").instance(0)';
  }
  return "-ios class chain:**/XCUIElementTypeTextField[1]";
}

export function firstPasswordInput(): string {
  if (driver.isAndroid) {
    return 'android=new UiSelector().className("android.widget.EditText").instance(1)';
  }
  return "-ios class chain:**/XCUIElementTypeSecureTextField[1]";
}

export async function tapVisibleText(text: string, timeout = DEFAULT_WAIT_MS): Promise<void> {
  const element = await visibleElementMatchingText(text, timeout);
  await element.click();
}

export async function tapTextIfVisible(text: string, timeout = 1_000): Promise<boolean> {
  try {
    const element = await visibleElementMatchingText(text, timeout);
    await element.click();
    return true;
  } catch {
    return false;
  }
}

export async function expectVisibleText(text: string, timeout = DEFAULT_WAIT_MS): Promise<void> {
  const element = await visibleElementMatchingText(text, timeout);
  await expect(element).toBeDisplayed();
}

export async function waitForAnyVisibleText(
  labels: string[],
  timeout = DEFAULT_WAIT_MS,
): Promise<{ label: string; element: ReturnType<typeof $> }> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    for (const label of labels) {
      try {
        const element = await visibleElementMatchingText(label, 500);
        return { label, element };
      } catch (error) {
        lastError = error;
      }
    }
    await browser.pause(500);
  }

  throw new Error(
    `None of these labels became visible: ${labels.join(", ")}${
      lastError instanceof Error ? `; last error: ${lastError.message}` : ""
    }`,
  );
}

export async function waitForPageSourceToMention(
  phrases: string[],
  timeout = DEFAULT_WAIT_MS,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const source = await driver.getPageSource();
      return phrases.some((phrase) => source.toLowerCase().includes(phrase.toLowerCase()));
    },
    { timeout, timeoutMsg: `Page source did not mention any of: ${phrases.join(", ")}` },
  );
}

export async function expectPageSourceToMention(phrases: string[]): Promise<void> {
  const source = await driver.getPageSource();
  const matched = phrases.some((phrase) => source.toLowerCase().includes(phrase.toLowerCase()));
  await expect(matched).toBe(true);
}

export async function typeInto(selector: string, value: string): Promise<void> {
  const input = await $(selector);
  await input.waitForDisplayed({ timeout: DEFAULT_WAIT_MS });
  await input.click();
  await input.setValue(value);
}

async function visibleElementMatchingText(text: string, timeout: number): Promise<ReturnType<typeof $>> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    for (const selector of [accessibleName(text), exactText(text)]) {
      try {
        const element = await $(selector);
        if ((await element.isDisplayed()) && (await elementCenterIsInsideViewport(element))) {
          return element;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await browser.pause(300);
  }

  throw new Error(
    `No visible element for "${text}"${
      lastError instanceof Error ? `; last error: ${lastError.message}` : ""
    }`,
  );
}

async function elementCenterIsInsideViewport(element: ReturnType<typeof $>): Promise<boolean> {
  const [location, size, viewport] = await Promise.all([
    element.getLocation(),
    element.getSize(),
    driver.getWindowRect(),
  ]);
  const centerX = location.x + size.width / 2;
  const centerY = location.y + size.height / 2;
  return centerX >= 0 && centerX <= viewport.width && centerY >= 0 && centerY <= viewport.height;
}

function iosLiteral(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
