import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver } from "../src/driver.js";
import { createNative } from "../src/native.js";

function fakeDriver(source: string): {
  driver: Driver;
  taps: [number, number][];
  cleared: string[];
  typed: string[];
} {
  const taps: [number, number][] = [];
  const cleared: string[] = [];
  const typed: string[] = [];
  return {
    taps,
    cleared,
    typed,
    driver: {
      platform: "android",
      source: async () => source,
      pause: async () => {},
      tapAt: async (x, y) => {
        taps.push([x, y]);
      },
      typeText: async (text) => {
        typed.push(text);
      },
      clearText: async () => {
        cleared.push("focused");
      },
    },
  };
}

test("createNative exposes direct text interactions and locators", async () => {
  const { driver, taps, cleared, typed } = fakeDriver(
    '<node class="android.widget.TextView" text="Email" bounds="[0,0][100,40]" enabled="true" />' +
      '<node class="android.widget.EditText" text="" bounds="[0,42][200,82]" enabled="true" />' +
      '<node text="Log in" bounds="[10,92][110,132]" clickable="true" enabled="true" />',
  );
  const visited: string[] = [];
  const native = createNative({
    driver: () => driver,
    navigate: async (route) => {
      visited.push(route);
    },
  });

  await native.navigate("/login");
  await native.fill("Email", "test@example.com");
  await native.tap("Log in");

  assert.deepEqual(visited, ["/login"]);
  assert.deepEqual(cleared, ["focused"]);
  assert.deepEqual(typed, ["test@example.com"]);
  assert.deepEqual(taps, [
    [100, 62],
    [60, 112],
  ]);
  assert.equal(await native.getByText("Log in").isVisible(), true);
});

test("native.fill targets the textfield nearest a visible label", async () => {
  const setValues: Array<{ node: string; text: string }> = [];
  const native = createNative({
    driver: () => ({
      platform: "android",
      source: async () =>
        '<node class="android.widget.TextView" text="Email" bounds="[0,0][100,40]" enabled="true" />' +
        '<node class="android.widget.EditText" text="" bounds="[0,42][200,82]" enabled="true" />',
      pause: async () => {},
      tapAt: async () => {
        throw new Error("native.fill should use setValueOnNode for the associated textfield");
      },
      setValueOnNode: async (node, text) => {
        setValues.push({ node, text });
        return /android\.widget\.EditText/.test(node);
      },
    }),
  });

  await native.fill("Email", "test@example.com");

  assert.equal(setValues.length, 1);
  const [setValue] = setValues;
  assert.ok(setValue);
  assert.match(setValue.node, /android\.widget\.EditText/);
  assert.equal(setValue.text, "test@example.com");
});

test("createNative keeps app routing explicit in nativeproof.config.ts", async () => {
  const { driver } = fakeDriver("");
  const native = createNative({ driver: () => driver });

  await assert.rejects(() => native.navigate("/login"), /native\.navigate.*nativeproof\.config\.ts/);
  await assert.rejects(() => native.launch({ route: "/login" }), /native\.launch.*nativeproof\.config\.ts/);
});
