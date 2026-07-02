# Device proof: atomic fill/clear via Driver.setValueOnNode (PR #63)

`prove-atomic-fill.ts` drives the real Settings app search field through
`Locator.fill()` / `Locator.clear()` on a live Appium session, with
`Driver.setValueOnNode` instrumented to show which path each call took.

Ran 2026-07-02 against Appium 3 (`--base-path /wd/hub`):

- **Android 15 emulator** (emulator-5554, UiAutomator2): `android-run.log` — 3/3 calls
  handled atomically, `fill("atomic")` replaced "hello world" instead of appending,
  `clear()` returned the field to its hint text. Screenshots `android-0*.png`.
- **iOS 26.5 iPhone 16 simulator** (XCUITest): `ios-run.log` — same result.
  Screenshots `ios-0*.png`.
