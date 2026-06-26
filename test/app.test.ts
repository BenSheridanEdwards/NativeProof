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

test("defineApp threads a richer mock type through the session context (no cast)", async () => {
  // An app whose mock extends the base contract with extra controls. Before the generic-mock
  // change, defineApp pinned the base MockBackend, so `mock.setVirtualUsers` below would not
  // type-check — forcing a cast. Now the concrete mock type flows to screens/teardown/context.
  interface RichMock extends MockBackend {
    setVirtualUsers(n: number): number;
  }
  let lastUsers = -1;
  const richBackend = (): RichMock => ({
    async frames() {
      return [];
    },
    route(): MockRoute {
      return { fulfill() {}, reject() {}, abort() {} };
    },
    async stop() {},
    setVirtualUsers(n) {
      lastUsers = n;
      return n;
    },
  });

  const app = defineApp({
    driver: () => driver,
    mock: richBackend,
    screens: {
      room: ({ mock }) => ({ seed: (n: number) => mock.setVirtualUsers(n) }),
    },
    teardown: ({ mock }) => {
      mock.setVirtualUsers(0);
    },
  });

  const session = app.session();
  const context = await session.setup();
  assert.equal(context.room.seed(5), 5); // a screen used the richer mock API, fully typed
  assert.equal(context.mock.setVirtualUsers(7), 7); // context.mock is the richer type, no cast
  await session.teardown(context);
  assert.equal(lastUsers, 0); // teardown used the richer mock API
});

test("defineApp accepts a frames+stop mock with no route() (SessionMock)", async () => {
  // A session never routes — only a spec does — so a mock that just observes frames and stops
  // is enough. This would not type-check when defineApp required the full MockBackend (route).
  const sessionMock = {
    async frames() {
      return [];
    },
    async stop() {},
  };
  const app = defineApp({ driver: () => driver, mock: () => sessionMock, screens: {} });
  const session = app.session();
  const context = await session.setup();
  assert.equal(typeof context.mock.frames, "function");
  await session.teardown(context);
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
