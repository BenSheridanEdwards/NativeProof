import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver, Platform } from "../src/driver.js";
import { page } from "../src/page.js";

/**
 * The getBy* ergonomics, against a fake source — no device. Proves each builder resolves
 * the right platform attribute (so selectors aren't inferred), and that getByRole({ name })
 * matches the role and accessible name together.
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

test("getByRole matches by name, or by element role when no name is given", async () => {
  const p = page(
    new FakeDriver(
      '<node class="android.widget.TextView" content-desc="Sign out" />' +
        '<node class="android.widget.Button" content-desc="Sign out" />' +
        '<node class="android.widget.CheckBox" content-desc="Accept Agreement" checked="true" bounds="[0,0][50,50]" />',
    ),
  );
  assert.equal(await p.getByRole("button", { name: "Sign out" }).isVisible(), true); // role + accessibility label
  assert.equal(await p.getByRole("checkbox", { name: "Sign out" }).isVisible(), false); // name alone is not enough
  assert.equal(await p.getByRole("checkbox", { name: /Accept Agreement/ }).isVisible(), true);
  assert.equal(await p.getByRole("checkbox").isVisible(), true); // no name → element class/type
  await assert.rejects(async () => p.getByRole("button", { name: "" }), /name must be non-empty/);
});

test("selectors map to iOS attributes when the platform is iOS", async () => {
  const ios =
    '<XCUIElementTypeStaticText label="Welcome" />' +
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="sign-out-button" label="Sign out" />' +
    '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Sign out" />';
  const p = page(new FakeDriver(ios, "ios"));
  assert.equal(await p.getByText("Welcome").isVisible(), true); // ios: label
  assert.equal(await p.getByTestId("sign-out-button").isVisible(), true); // ios: name
  assert.equal(await p.getByRole("button", { name: "Sign out" }).isVisible(), true);
  assert.equal(await p.getByRole("checkbox", { name: "Sign out" }).isVisible(), false);
});
