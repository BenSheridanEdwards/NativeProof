import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineApp } from "../src/app.js";
import type { Driver, Platform } from "../src/driver.js";
import { expect } from "../src/expect.js";
import { by, Locator } from "../src/locator.js";
import type { MockBackend, MockFrame, MockRoute } from "../src/mock.js";
import { createNative } from "../src/native.js";

/**
 * End-to-end demo of the full DX against a fake device — no emulator, no real app.
 * This is the "it reads like a native Playwright test AND works standalone" proof: runner-native
 * describe/it, direct native controls, locators, expect, and route-style mock assertions.
 */
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

  async typeText(text: string): Promise<void> {
    this.backend.record({ path: "/input", type: "typed", payload: { text }, direction: "sent" });
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

const native = createNative({
  driver: () => driver,
  async navigate(route) {
    assert.equal(route, "/demo");
  },
});

describe("demo app (fake device, no emulator)", () => {
  it("shows the greeting, taps submit, and observes the sent frame", async () => {
    await native.navigate("/demo");
    await expect(native.getByText("Welcome")).toShow("Welcome");
    await native.tap("Submit");
    await expect(backend).toHaveSent({ path: "/action", type: "submit" });
    await expect(backend).not.toHaveReceived({ type: "incoming" }, { timeout: 20, interval: 5 });
  });

  it("defineApp remains available for advanced fixture scenarios", () => {
    assert.equal(typeof demoApp.session, "function");
  });
});
