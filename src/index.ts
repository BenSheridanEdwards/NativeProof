/**
 * NativeProof — Playwright-feeling native mobile E2E for Appium/WebdriverIO.
 *
 * Playwright's native-testing feel (runner-native describe/it, direct native controls, locators,
 * expect, route-style mocking, evidence) layered on Appium/WebdriverIO, which can drive the native
 * iOS/Android surfaces Playwright cannot. App-agnostic: consumers keep app-specifics in
 * nativeproof.config.ts; nothing in this package imports app-specific code.
 */
export * from "./adb.js";
export * from "./app.js";
export * from "./config.js";
export * from "./driver.js";
export * from "./evidence.js";
export * from "./expect.js";
export * from "./fixtures.js";
export * from "./gestures.js";
export * from "./harness.js";
export * from "./inspect.js";
export * from "./ios.js";
export * from "./locator.js";
export * from "./log.js";
export * from "./mock.js";
export * from "./mock-server.js";
export * from "./native.js";
export * from "./page.js";
export * from "./runner.js";
export * from "./source.js";
