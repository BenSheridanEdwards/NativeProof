/**
 * NativeProof — Playwright-feeling native mobile E2E for Appium/WebdriverIO.
 *
 * Playwright's native-testing feel (runner-native describe/it, direct native controls, locators,
 * expect, route-style mocking, evidence) layered on Appium/WebdriverIO, which can drive the native
 * iOS/Android surfaces Playwright cannot. App-agnostic: consumers keep app-specifics in
 * nativeproof.config.ts; nothing in this package imports app-specific code.
 */

export type {
  App,
  AppDefinition,
  DeviceContext,
  FlowContext,
  ScreenFactories,
  ScreenFactory,
  SessionContext,
} from "./app.js";
export { defineApp } from "./app.js";
export type { AppiumOptions, DeviceProject, NativeProofConfig, RunnerConfig } from "./config.js";
export { defineConfig } from "./config.js";
export type { Driver, Platform } from "./driver.js";
export { wdioDriver } from "./driver.js";
export { captureState } from "./evidence.js";
export type { LocatorAssertions, MockAssertions, ValueAssertions } from "./expect.js";
export { expect } from "./expect.js";
export type { FailureInfo, ScenarioFixture } from "./fixtures.js";
export type { Harness, HarnessTest } from "./harness.js";
export { createHarness } from "./harness.js";
export type {
  Locator,
  PressOptions,
  ScrollDirection,
  ScrollOptions,
  Selector,
  TapOptions,
  WaitOptions,
} from "./locator.js";
export { by } from "./locator.js";
export type {
  FrameDirection,
  FrameLog,
  FrameMatch,
  MockBackend,
  MockFrame,
  MockRoute,
  SessionMock,
} from "./mock.js";
export type { MockServer, MockServerOptions } from "./mock-server.js";
export { startMockServer } from "./mock-server.js";
export type { Native, NativeLaunchContext, NativeNavigateContext, NativeOptions } from "./native.js";
export { createNative } from "./native.js";
export type { Page } from "./page.js";
