# Changelog

All notable changes to NativeProof are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

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
