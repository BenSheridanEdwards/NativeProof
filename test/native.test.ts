import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver } from "../src/driver.js";
import { createNative } from "../src/native.js";

function fakeDriver(source: string): { driver: Driver; taps: [number, number][]; typed: string[] } {
  const taps: [number, number][] = [];
  const typed: string[] = [];
  return {
    taps,
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
    },
  };
}

test("createNative exposes direct text interactions and locators", async () => {
  const { driver, taps, typed } = fakeDriver(
    '<node text="Email" bounds="[0,0][100,40]" enabled="true" />' +
      '<node text="Log in" bounds="[10,50][110,90]" clickable="true" enabled="true" />',
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
  assert.deepEqual(typed, ["test@example.com"]);
  assert.deepEqual(taps, [
    [50, 20],
    [60, 70],
  ]);
  assert.equal(await native.getByText("Log in").isVisible(), true);
});

test("createNative keeps app routing explicit in nativeproof.config.ts", async () => {
  const { driver } = fakeDriver("");
  const native = createNative({ driver: () => driver });

  await assert.rejects(() => native.navigate("/login"), /native\.navigate.*nativeproof\.config\.ts/);
  await assert.rejects(() => native.launch({ route: "/login" }), /native\.launch.*nativeproof\.config\.ts/);
});
