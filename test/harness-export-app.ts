import { defineApp } from "../src/app.js";
import type { Driver, Platform } from "../src/driver.js";
import { createHarness } from "../src/harness.js";
import type { MockBackend, MockRoute } from "../src/mock.js";

/**
 * A harness exported from one module and consumed by `harness.test.ts` — the real
 * `export const { test } = createHarness(app)` shape. This is a *type-level* regression guard:
 * the screen's value type must survive the import boundary. If `createHarness` lost the resolved
 * context (e.g. widened the screens type to its constraint), `home.marker` would be `unknown` in
 * the consumer and `tsc --noEmit` (run by `npm run check`) would fail. The app has a `login` flow
 * so the context isn't a bare `screens`-only definition.
 */
const driver: Driver = {
  platform: "android" as Platform,
  async source() {
    return "";
  },
  async pause() {},
  async tapAt() {},
};

const backend: MockBackend = {
  async frames() {
    return [];
  },
  route(): MockRoute {
    return { fulfill() {}, reject() {}, abort() {} };
  },
  async stop() {},
};

const app = defineApp({
  driver: () => driver,
  mock: () => backend,
  login: async ({ role }) => {
    void role;
  },
  screens: {
    home: ({ mock }) => ({ marker: "home-screen", sameMock: mock }),
  },
});

export const { test, expect } = createHarness(app);
