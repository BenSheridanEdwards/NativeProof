import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defineApp } from "../src/app.js";
import type { Driver, Platform } from "../src/driver.js";
import { createHarness } from "../src/harness.js";
import type { MockBackend, MockRoute } from "../src/mock.js";
import { useRunner } from "../src/runner.js";

/**
 * createHarness coverage under node:test (wired as the BDD runner). Proves the bound
 * test/test.describe runs, passes the role through login, and injects the typed
 * session context (mock + screens) into each behaviour — no device.
 */
useRunner({ describe, before, after, it });

const noopBackend: MockBackend = {
  async frames() {
    return [];
  },
  route(): MockRoute {
    return { fulfill() {}, reject() {}, abort() {} };
  },
  async stop() {},
};

const noopDriver: Driver = {
  platform: "android" as Platform,
  async source() {
    return "";
  },
  async pause() {},
  async tapAt() {},
};

let loggedInRole: string | undefined;

const app = defineApp({
  driver: () => noopDriver,
  mock: () => noopBackend,
  login: async ({ role }) => {
    loggedInRole = role;
  },
  screens: {
    home: ({ mock }) => ({ marker: "home-screen", sameMock: mock }),
  },
});

const { test, expect } = createHarness(app);

test.describe("createHarness injects the typed context for a role", "member", () => {
  test("each behaviour receives { mock, home } and login saw the role", async ({ mock, home }) => {
    assert.equal(home.marker, "home-screen");
    assert.equal(loggedInRole, "member");
    assert.equal(home.sameMock, mock); // the screen factory was handed the same mock as the context
    assert.equal(typeof expect, "function");
  });
});

test.describe("createHarness defaults the role when omitted", () => {
  test("runs with the default session", async ({ home }) => {
    assert.equal(home.marker, "home-screen");
  });
});
