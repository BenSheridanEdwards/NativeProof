import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver, Platform } from "../src/driver.js";
import { page } from "../src/page.js";

/**
 * The getBy* ergonomics, against a fake source — no device. Proves each builder resolves
 * the right platform attribute (so selectors aren't inferred), and that getByRole keys
 * off the accessible name on native.
 */
class FakeDriver implements Driver {
  constructor(
    private readonly src: string,
    readonly platform: Platform = "android",
  ) {}

  async source(): Promise<string> {
    return this.src;
  }
  async pause(): Promise<void> {}
  async tapAt(): Promise<void> {}
}

const ANDROID = '<node text="Welcome" /><node content-desc="Sign out" /><node resource-id="login-button" />';

test("getByText / getByLabel / getByTestId / getById resolve the right Android attributes", async () => {
  const p = page(new FakeDriver(ANDROID));
  assert.equal(await p.getByText("Welcome").isVisible(), true);
  assert.equal(await p.getByLabel("Sign out").isVisible(), true); // content-desc
  assert.equal(await p.getByTestId("login-button").isVisible(), true); // resource-id
  assert.equal(await p.getById("login-button").isVisible(), true); // resource-id
  assert.equal(await p.getByText("Nope").isVisible(), false);
});

test("getByRole matches the accessible name (role advisory on native)", async () => {
  const p = page(new FakeDriver(ANDROID));
  assert.equal(await p.getByRole("button", { name: "Sign out" }).isVisible(), true);
  await assert.rejects(async () => p.getByRole("button", { name: "" }), /needs \{ name \}/);
});

test("selectors map to iOS attributes when the platform is iOS", async () => {
  const ios = '<XCUIElementTypeStaticText label="Welcome" /><XCUIElementTypeButton name="Sign out" />';
  const p = page(new FakeDriver(ios, "ios"));
  assert.equal(await p.getByText("Welcome").isVisible(), true); // ios: label
  assert.equal(await p.getByTestId("Sign out").isVisible(), true); // ios: name
});
