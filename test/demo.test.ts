import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { defineApp } from "../src/app.js";
import type { Driver, Platform } from "../src/driver.js";
import { expect } from "../src/expect.js";
import { by, Locator } from "../src/locator.js";
import type { MockBackend, MockFrame, MockRoute } from "../src/mock.js";
import { useRunner } from "../src/runner.js";
import { test } from "../src/test.js";

/**
 * End-to-end demo of the full DX against a fake device — no emulator, no real app.
 * This is the "it reads like Playwright AND works standalone" proof: defineApp (the
 * single seam), the test/test.describe facade, locators, expect, and route-style mock
 * assertions, all composed and run here under node:test (wired as the BDD runner).
 */
useRunner({ describe, before, after, it });

class FakeBackend implements MockBackend {
  private readonly recorded: MockFrame[] = [];

  record(frame: MockFrame): void {
    this.recorded.push(frame);
  }

  async frames(): Promise<readonly MockFrame[]> {
    return this.recorded;
  }

  route(): MockRoute {
    return { fulfill() {}, reject() {}, abort() {} };
  }

  async stop(): Promise<void> {}
}

class FakeDriver implements Driver {
  platform: Platform = "android";

  constructor(
    private readonly backend: FakeBackend,
    private src = "",
  ) {}

  async source(): Promise<string> {
    return this.src;
  }

  async pause(): Promise<void> {}

  async tapAt(): Promise<void> {
    // Model the app reacting to a tap by sending a frame to its backend.
    this.backend.record({ path: "/action", type: "submit", direction: "sent" });
  }
}

const backend = new FakeBackend();
const driver = new FakeDriver(
  backend,
  '<node text="Welcome" bounds="[0,0][200,80]" /><node content-desc="Submit" bounds="[0,100][200,180]" />',
);

const demoApp = defineApp({
  driver: () => driver,
  mock: () => backend,
  login: async () => {},
  screens: {
    home: ({ driver }) => ({
      greeting: new Locator(driver, by.text("Welcome")),
      submit: new Locator(driver, by.desc("Submit")),
    }),
  },
});

test.describe("demo app (fake device, no emulator)", demoApp.session(), (test) => {
  test("shows the greeting, taps submit, and observes the sent frame", async ({ home, mock }) => {
    await expect(home.greeting).toShow("Welcome");
    await home.submit.tap();
    await expect(mock).toHaveSent({ path: "/action", type: "submit" });
    await expect(mock).not.toHaveReceived({ type: "incoming" }, { timeout: 20, interval: 5 });
  });

  test("defineApp exposes a session fixture", () => {
    assert.equal(typeof demoApp.session, "function");
  });
});
