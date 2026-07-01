/**
 * Network-evidence log helpers.
 *
 * The mock backend writes request and socket activity as JSONL. These pure
 * helpers let assertions reason about app-originated network behaviour — the
 * Playwright-`page.route()` equivalent that native Appium otherwise lacks.
 * App-agnostic; app-specific frame semantics live in the consumer's assertions.
 */

export function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (text.match(new RegExp(pattern.source, flags)) ?? []).length;
}

/**
 * Tokens that must never appear in captured evidence. App-agnostic by default
 * (non-fake Bearer tokens); a consumer composes in its own app-specific secrets
 * (e.g. a passcode literal) — destined to become injected config.
 */
export const LEAKED_SECRET_PATTERN = /Bearer\s+(?!fake-e2e)[A-Za-z0-9._-]+/i;

export function containsLeakedSecret(text: string): boolean {
  return LEAKED_SECRET_PATTERN.test(text);
}
