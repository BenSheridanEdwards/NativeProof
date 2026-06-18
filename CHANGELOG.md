# Changelog

All notable changes to NativeProof are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## 0.4.0

Dead-code removal. The dropped exports were undocumented and unused by the framework, but
since they were technically part of the published surface this is a minor bump.

**Removed**

- **`src/text.ts`** — a legacy WebdriverIO-`$`-based selector/text layer (`exactText`,
  `tapVisibleText`, `typeInto`, `waitForAnyVisibleText`, …) superseded by the `Driver` / `Locator` /
  `page` stack. Use `page(driver).getByText(...)` / `Locator.fill(...)` instead.
- **`src/screen.ts`** — the unused `Screen` base class (nothing extended it).
- **`src/wait.ts`** — `waitAndClick` / `waitForAnyDisplayed`, only ever used by `Screen`.
- **`readLog`** (from `log.ts`) and **`waitForFrame`** (from `mock.ts`) — unused exports. The
  documented mock-traffic API (`expect(mock).toHaveSent/toHaveReceived`) is unaffected.

## 0.3.0

Maintenance release — version bump only; no functional changes since 0.2.0.

## 0.2.0

Locator interaction, generic assertions, and Compose/SwiftUI robustness — plus the docs for each.

**Added**

- **`Locator.fill(text, opts?)`** — native text entry, the analogue of Playwright's `locator.fill()`:
  it focuses the field (a `tap()`) and types through the device keyboard. New optional `Driver.typeText?`
  hook (`wdioDriver()` implements it via `browser.keys`); `fill()` throws a clear error on drivers
  without text input. It does **not** clear existing content first. (#5)
- **Generic `expect(value)` matchers** — `toBe` / `toEqual` / `toContain` / `toBeTruthy` / `toBeFalsy` /
  `toBeDefined` / `toBeNull` (+ `.not`). These are **synchronous** (unlike the auto-waiting locator/mock
  matchers), so non-UI checks (counts, ids, parsed payloads) need no second assertion library. (#4)
- **`tap({ clickableAncestor: true })`** — taps the smallest `clickable="true"` ancestor that contains
  the matched node, for Compose/SwiftUI labels that sit on a non-clickable child of the real touch target. (#3)

**Changed**

- **`getByText` / `by.text` is now forgiving** — it matches `text` *or* `content-desc` on Android and
  `label` *or* `value` on iOS, so a visible label is found wherever the toolkit exposes it. This broadens
  matching for existing `by.text` selectors; use `getByLabel` / `by.desc` when you want the accessibility
  description specifically. (#3)

**Fixed**

- **XML entity handling in locators** — selectors built from human-readable strings
  (`by.text("Terms & Conditions")`) now match the entity-escaped page source, and `textContent()` decodes
  entities back to plain text. (#2)
- **`./package.json` is now exported** — resolvable through the package `exports` map for tooling and
  bundlers that read it. (#1)

**Docs**

- "Bring your own backend" — documents the `MockBackend` adapter pattern for apps with an existing mock
  server, and clarifies which symbols import from `nativeproof` vs your `nativeproof.config`. (#6)
- Every feature above is documented in the README (Locators, Assertions, Features, API reference).

## 0.1.1

Documentation pass: refreshed the README examples, expanded the iOS setup guide, and
tidied the inline API docs. No API or behaviour changes.

## 0.1.0

Initial release — a Native Mobile E2E test framework inspired by Playwright, on
Appium/WebdriverIO.

- **Fixtures** — `defineApp` (the single app seam) and `createHarness(app)` for a typed,
  module-global `test` / `test.describe` with the session context injected per behaviour.
- **Config** — `nativeproof.config.ts` + `defineConfig` (the `playwright.config.ts` analogue);
  the `nativeproof` CLI auto-discovers it and synthesises the WebdriverIO run.
- **Locators** — `by.text/testId/label/desc/id` and `page(driver).getByText/getByTestId/
  getByLabel/getById/getByRole`, mapped to the right native attribute per platform.
- **Assertions** — auto-waiting `expect(locator).toBeVisible/toShow/toHaveText` and
  `expect(mock).toHaveSent/toHaveReceived`, each with `.not`.
- **Network mocking** — a first-party HTTP + WebSocket mock server with Playwright-style
  `route().fulfill/reject/abort` and traffic assertions; no per-app adapter.
- **Device commands** — Android `adb` (`adbForceStop`, `resetAppAndBrowserState`, `adbTap`, …)
  and iOS `simctl` (`iosTerminate/Launch/Install/Uninstall/Boot/Shutdown`, `resetAppState`).
- **CLI** — `nativeproof` runs the suite (auto-starts Appium), for Android and iOS.
