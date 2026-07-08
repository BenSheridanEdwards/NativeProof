import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.js";
import {
  type App,
  type AppDefinition,
  type AppiumOptions,
  by,
  captureState,
  createHarness,
  createNative,
  type DeviceContext,
  type DeviceProject,
  type Driver,
  defineApp,
  defineConfig,
  expect,
  type FailureInfo,
  type FlowContext,
  type FrameDirection,
  type FrameLog,
  type FrameMatch,
  type Harness,
  type HarnessTest,
  type Locator,
  type LocatorAssertions,
  type MockAssertions,
  type MockBackend,
  type MockFrame,
  type MockRoute,
  type MockServer,
  type MockServerOptions,
  type Native,
  type NativeLaunchContext,
  type NativeNavigateContext,
  type NativeOptions,
  type NativeProofConfig,
  type Page,
  type Platform,
  type PressOptions,
  type RunnerConfig,
  type ScenarioFixture,
  type ScreenFactories,
  type ScreenFactory,
  type ScrollDirection,
  type ScrollOptions,
  type Selector,
  type SessionContext,
  type SessionMock,
  startMockServer,
  type TapOptions,
  type ValueAssertions,
  type WaitOptions,
  wdioDriver,
} from "../src/index.js";

type PublicTypeSmoke = {
  app: App<unknown>;
  appDefinition: AppDefinition<ScreenFactories>;
  appium: AppiumOptions;
  device: DeviceContext;
  driver: Driver;
  failure: FailureInfo;
  flow: FlowContext;
  frameDirection: FrameDirection;
  frameLog: FrameLog;
  frameMatch: FrameMatch;
  harness: Harness<unknown>;
  harnessTest: HarnessTest<unknown>;
  locator: Locator;
  locatorAssertions: LocatorAssertions;
  mockAssertions: MockAssertions;
  mockBackend: MockBackend;
  mockFrame: MockFrame;
  mockRoute: MockRoute;
  mockServer: MockServer;
  mockServerOptions: MockServerOptions;
  native: Native;
  nativeLaunchContext: NativeLaunchContext;
  nativeNavigateContext: NativeNavigateContext;
  nativeOptions: NativeOptions;
  nativeProofConfig: NativeProofConfig;
  page: Page;
  platform: Platform;
  pressOptions: PressOptions;
  project: DeviceProject;
  runnerConfig: RunnerConfig;
  scenarioFixture: ScenarioFixture<unknown>;
  screenFactories: ScreenFactories;
  screenFactory: ScreenFactory<unknown>;
  scrollDirection: ScrollDirection;
  scrollOptions: ScrollOptions;
  selector: Selector;
  sessionContext: SessionContext<ScreenFactories>;
  sessionMock: SessionMock;
  tapOptions: TapOptions;
  valueAssertions: ValueAssertions<number>;
  waitOptions: WaitOptions;
};

test("public entry point exposes only the supported runtime API", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "by",
    "captureState",
    "createHarness",
    "createNative",
    "defineApp",
    "defineConfig",
    "expect",
    "startMockServer",
    "wdioDriver",
  ]);
  assert.equal(api.by, by);
  assert.equal(api.captureState, captureState);
  assert.equal(api.createHarness, createHarness);
  assert.equal(api.createNative, createNative);
  assert.equal(api.defineApp, defineApp);
  assert.equal(api.defineConfig, defineConfig);
  assert.equal(api.expect, expect);
  assert.equal(api.startMockServer, startMockServer);
  assert.equal(api.wdioDriver, wdioDriver);

  for (const internal of [
    "adbDump",
    "attrPattern",
    "boundsForContentDesc",
    "countMatches",
    "describeScenario",
    "exactNodeXPath",
    "LEAKED_SECRET_PATTERN",
    "nodesForAttribute",
    "simctlArgv",
    "useRunner",
    "waitUntil",
  ]) {
    assert.equal(Object.hasOwn(api, internal), false);
  }

  const typeSmoke: PublicTypeSmoke | null = null;
  assert.equal(typeSmoke, null);
});
