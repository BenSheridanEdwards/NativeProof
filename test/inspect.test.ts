import assert from "node:assert/strict";
import { test } from "node:test";
import { selectorSuggestions } from "../src/inspect.js";

/** Selector discovery over realistic page-source shapes — pure, no device. */

test("android sources suggest roles first, then visible text, then test ids", () => {
  const source =
    '<node class="android.widget.CheckBox" content-desc="Accept terms" checked="false" bounds="[0,0][40,40]" />' +
    '<node class="android.widget.TextView" text="Welcome back" bounds="[0,60][200,100]" />' +
    '<node class="android.widget.EditText" text="" resource-id="com.app:id/email" bounds="[0,120][200,160]" />';
  const suggestions = selectorSuggestions(source, "android");
  assert.deepEqual(suggestions, [
    'native.getByRole("checkbox", { name: "Accept terms" })',
    'native.getByRole("textfield")',
    'native.getByText("Accept terms")',
    'native.getByText("Welcome back")',
    'native.getByTestId("com.app:id/email")',
  ]);
});

test("inspect skips transient input values but keeps labels and test ids", () => {
  const source =
    '<XCUIElementTypeButton type="XCUIElementTypeButton" name="Log in" label="Log in" x="0" y="0" width="100" height="40" />' +
    '<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="session-field" label="" placeholderValue="Session ID" value="abc123" x="0" y="50" width="100" height="40" />';
  const suggestions = selectorSuggestions(source, "ios");
  assert.deepEqual(suggestions, [
    'native.getByRole("button", { name: "Log in" })',
    'native.getByRole("textfield")',
    'native.getByText("Log in")',
    'native.getByTestId("session-field")',
  ]);

  assert.deepEqual(
    selectorSuggestions(
      '<node class="android.widget.EditText" text="me@example.com" resource-id="com.app:id/email" bounds="[0,0][100,40]" />',
      "android",
    ),
    ['native.getByRole("textfield")', 'native.getByTestId("com.app:id/email")'],
  );
});

test("suggestions skip empty and over-long values and deduplicate", () => {
  const long = "x".repeat(80);
  const source =
    `<node text="${long}" bounds="[0,0][10,10]" />` +
    '<node text="Save" bounds="[0,0][10,10]" /><node text="Save" bounds="[0,20][10,30]" /><node text="" />';
  assert.deepEqual(selectorSuggestions(source, "android"), ['native.getByText("Save")']);
});
