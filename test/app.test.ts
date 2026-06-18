import assert from "node:assert/strict";
import { test } from "node:test";
import { defineApp } from "../src/app.js";
import type { Driver, Platform } from "../src/driver.js";
import type { MockBackend, MockRoute } from "../src/mock.js";

/**
 * defineApp session lifecycle — the optional app `teardown` hook runs before the mock
 * stops (so an app can force-stop itself before the runner deletes the device session),
 * and the mock is stopped even if that hook throws. No device.
 */

const driver: Driver = {
  platform: "android" as Platform,
  async source() {
    return "";
  },
  async pause() {},
  async tapAt() {},
};

function backend(onStop: () => void): MockBackend {
  return {
    async frames() {
      return [];
    },
    route(): MockRoute {
      return { fulfill() {}, reject() {}, abort() {} };
    },
    async stop() {
      onStop();
    },
  };
}

test("defineApp teardown runs the app hook before the mock stops", async () => {
  const order: string[] = [];
  const app = defineApp({
    driver: () => driver,
    mock: () => backend(() => order.push("mock.stop")),
    teardown: async () => {
      order.push("app.teardown");
    },
    screens: {},
  });
  const session = app.session();
  const context = await session.setup();
  await session.teardown(context);
  assert.deepEqual(order, ["app.teardown", "mock.stop"]);
});

test("defineApp still stops the mock when the teardown hook throws", async () => {
  let stopped = false;
  const app = defineApp({
    driver: () => driver,
    mock: () =>
      backend(() => {
        stopped = true;
      }),
    teardown: async () => {
      throw new Error("boom");
    },
    screens: {},
  });
  const session = app.session();
  const context = await session.setup();
  await assert.rejects(() => session.teardown(context), /boom/);
  assert.equal(stopped, true);
});
