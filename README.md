# NativeProof

A **Native Mobile E2E test framework inspired by Playwright**. NativeProof brings Playwright's
developer experience — **`test` / `describe` blocks, locators, auto-waiting `expect`,
route-style network interception, fixtures, per-test isolation, evidence capture** — to
**native iOS and Android** apps, layered on **Appium / WebdriverIO** (which can drive the
native surfaces Playwright itself cannot).

```ts
import { test, expect } from "./nativeproof.config";

test.describe("chat room", "member", () => {
  test("renders the latest message and posts a reply", async ({ member, mock }) => {
    await expect(member.messages).toShow("Welcome to the room");
    await member.sendButton.tap();
    await expect(mock).toHaveSent({ path: "/messages", type: "create", roomId: "general" });
  });
});
```

One command runs it on a device or emulator:

```bash
nativeproof --platform android
```

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Project setup](#project-setup)
- [Android setup](#android-setup)
- [iOS setup](#ios-setup)
- [Writing tests](#writing-tests)
  - [Test blocks](#test-blocks-describe--test)
  - [Fixtures, roles & the app seam](#fixtures-roles--the-app-seam)
  - [Locators](#locators)
  - [Assertions](#assertions)
  - [Network interception & assertions](#network-interception--assertions)
  - [Bring your own backend](#bring-your-own-backend)
  - [Gestures & scrolling](#gestures--scrolling)
  - [Evidence & secrets](#evidence--secrets)
- [Running](#running)
- [CI](#ci)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)
- [How it works](#how-it-works)

---

## Features

- **Reads like Playwright** — `test.describe` / `test(...)` blocks with a typed fixture
  context injected; no per-test setup/teardown in the spec.
- **Locators** — `by.text/testId/label/desc/id` and `page(driver).getByText/getByTestId/
  getByLabel/getById/getByRole`, each mapped to the right native attribute per platform (so you
  never guess `content-desc` vs `accessibilityIdentifier`), with built-in auto-waiting and
  `tap()` / `fill()` for interaction.
- **Auto-waiting `expect`** — `expect(locator).toBeVisible()/toShow()/toHaveText()` and
  `.not`, each polling until the condition holds (default 10s); plus synchronous `expect(value)`
  matchers (`toBe`/`toEqual`/`toContain`/…) so non-UI checks need no second assertion library.
- **Network interception** — a first-party HTTP + WebSocket mock server with
  `route().fulfill/reject/abort` (like `page.route()`) and `expect(mock).toHaveSent()/
  toHaveReceived()` traffic assertions. No per-app adapter.
- **One seam, by injection** — a single `defineApp(...)` declares the device, mock,
  login/join flows, screens and secret patterns; the core imports nothing app-specific.
- **Cross-platform** — the same spec runs on Android (UiAutomator2) and iOS (XCUITest).
- **One command** — `nativeproof` resolves your config, ensures Appium is up, and runs the suite.
- **TypeScript-first**, strict, with evidence (redacted screenshots + page source) for an
  auditable green run.

## Requirements

- **Node.js ≥ 20**
- **Appium 3** + the platform driver(s): `uiautomator2` (Android) and/or `xcuitest` (iOS, macOS only)
- **Android:** Android SDK (platform-tools + emulator) and JDK 17
- **iOS:** macOS with Xcode + Command Line Tools
- A **debug / E2E build** of the app under test (`.apk` for Android, `.app`/`.ipa` for iOS)

## Install

```bash
npm i -D nativeproof \
  webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework \
  appium

# install the Appium driver(s) you need
npx appium driver install uiautomator2   # Android
npx appium driver install xcuitest        # iOS (macOS only)

# optional: verify the toolchain is wired up
npx appium driver doctor uiautomator2
```

## Quick start

Four steps from zero to a green run on Android.

**1. Configure** — one `nativeproof.config.ts` at the project root:

```ts
import { createHarness, defineApp, defineConfig, page, startMockServer, wdioDriver } from "nativeproof";

const app = defineApp({
  driver: () => wdioDriver(),
  mock: () => startMockServer({ port: 18113, host: "0.0.0.0" }), // 0.0.0.0 so a device can reach it
  screens: {
    home: ({ driver }) => ({
      title: page(driver).getByText("Welcome"),
      start: page(driver).getByRole("button", { name: "Get started" }),
    }),
  },
});

export const { test, expect } = createHarness(app); // specs import these

export default defineConfig({
  app,
  testDir: "tests",
  projects: [
    {
      name: "android",
      platform: "android",
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:app": process.env.ANDROID_APP ?? "app/android/app-debug.apk",
        "appium:autoGrantPermissions": true,
      },
    },
  ],
});
```

**2. Write a spec** — `tests/home.spec.ts`:

```ts
import { test, expect } from "../nativeproof.config";

test.describe("home screen", () => {
  test("greets the user and starts", async ({ home }) => {
    await expect(home.title).toBeVisible();
    await home.start.tap();
  });
});
```

**3. Boot a device** — an emulator (Android) or simulator (iOS) must be running (see
[Android setup](#android-setup) / [iOS setup](#ios-setup)).

**4. Run:**

```bash
npx nativeproof --platform android
```

`nativeproof` discovers the config, starts Appium if it isn't already up, and runs the suite.

## Project setup

Everything lives in one **`nativeproof.config.ts`** — the `playwright.config.ts` analogue. It
declares the app (the injected seam), exports the typed `test` / `expect` your specs import,
and lists the device **projects**. The CLI auto-discovers it and synthesises the WebdriverIO
run, so there's no hand-written `wdio.conf.ts`.

A typical project:

```
my-app-e2e/
├─ nativeproof.config.ts  # the single config — app, device projects, test/expect exports
├─ tests/
│  ├─ home.spec.ts
│  └─ chat.spec.ts
└─ app/
   ├─ android/app-debug.apk
   └─ ios/MyApp.app
```

The full, cross-platform config:

```ts
// nativeproof.config.ts
import { createHarness, defineApp, defineConfig, page, startMockServer, wdioDriver } from "nativeproof";

const app = defineApp({
  driver: () => wdioDriver(),                       // the live WebdriverIO/Appium session
  mock: () => startMockServer({ port: 18113, host: "0.0.0.0" }), // first-party mock; route()/frames built in
  secrets: [/\b\d{6}\b/],                           // app-specific patterns kept out of captured evidence
  login: async ({ role, driver, mock }) => {
    // drive your app's sign-in; `mock` is the running backend, `role` comes from the describe
  },
  screens: {
    member: ({ driver }) => {
      const p = page(driver);
      return {
        messages: p.getByTestId("message-list"),
        roomTitle: p.getByTestId("room-title"),
        composer: p.getByTestId("composer"),
        sendButton: p.getByRole("button", { name: "Send" }),
        errorBanner: p.getByTestId("error-banner"),
        spinner: p.getByTestId("loading"),
        signOut: p.getByLabel("Sign out"),
      };
    },
  },
});

// specs do:  import { test, expect } from "../nativeproof.config";
export const { test, expect } = createHarness(app);

export default defineConfig({
  app,
  testDir: "tests",
  projects: [
    {
      name: "android",
      platform: "android",
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:app": process.env.ANDROID_APP ?? "app/android/app-debug.apk",
        "appium:autoGrantPermissions": true,
      },
    },
    {
      name: "ios",
      platform: "ios",
      capabilities: {
        platformName: "iOS",
        "appium:automationName": "XCUITest",
        "appium:deviceName": "iPhone 15",
        "appium:platformVersion": "17.5",
        "appium:app": process.env.IOS_APP ?? "app/ios/MyApp.app",
      },
    },
  ],
});
```

> File names are conventions, not requirements. Prefer a raw WebdriverIO config? Keep a
> `wdio.conf.ts` (or pass `nativeproof --config <path>`) — NativeProof uses it when there's no
> `nativeproof.config.ts`.

## Android setup

1. **SDK & JDK.** Install Android Studio (or the command-line tools) and set:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"     # Linux: ~/Android/Sdk
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)"  # JDK 17
   ```
2. **Driver:** `npx appium driver install uiautomator2`.
3. **Emulator.** Create an AVD (Android Studio → Device Manager, or `avdmanager`) and boot it:
   ```bash
   emulator -avd Pixel_7_API_34 -no-window -no-audio &
   adb wait-for-device
   adb devices            # should list the emulator
   ```
4. **App build.** Point `ANDROID_APP` at your debug/E2E `.apk` (or use `appium:appPackage` +
   `appium:appActivity` for an already-installed build).
5. **Mock host.** From an emulator, the host machine is reachable at **`10.0.2.2`** — build your
   E2E app so its backend base URL is `http://10.0.2.2:18113` (the mock server's port). Bind the
   mock with `host: "0.0.0.0"` so the device can reach it (a real device uses your Mac's LAN IP,
   e.g. `http://192.168.1.20:18113`). Then `mock.route(...)` and `expect(mock)` see the traffic.

## iOS setup

> iOS requires **macOS** (Appium's `xcuitest` driver builds on Xcode and is macOS-only).

1. **Xcode + Command Line Tools.** Install Xcode from the App Store, then:
   ```bash
   xcode-select --install
   xcodebuild -version          # confirms the toolchain is wired up
   sudo xcodebuild -license accept
   ```
2. **Driver:** `npx appium driver install xcuitest`. On the first run it builds
   **WebDriverAgent** (the on-device agent Appium drives). For the simulator this is automatic;
   for a **real device** you must sign WDA once — set `appium:xcodeOrgId` (your Apple Team ID)
   and `appium:xcodeSigningId` ("Apple Development"), or open
   `node_modules/appium-xcuitest-driver/.../WebDriverAgent.xcodeproj` in Xcode and select a
   signing team. Give the first launch room with `appium:wdaLaunchTimeout`.
3. **Simulator.** List and boot one (Xcode → Settings → Components installs runtimes):
   ```bash
   xcrun simctl list devices            # names + UDIDs of installed simulators
   xcrun simctl boot "iPhone 15"        # or boot by UDID
   open -a Simulator                    # optional: watch it run
   ```
   Match `appium:deviceName` / `appium:platformVersion` to a simulator that exists, or pin a
   specific one with `appium:udid`.
4. **App build.**
   - **Simulator:** point `IOS_APP` at a simulator-built `.app` (an `arm64`/`x86_64` simulator
     binary, not a device build), e.g. `app/ios/MyApp.app`.
   - **Real device:** point `IOS_APP` at a signed `.ipa`, set `appium:udid`, and use a
     provisioning profile that covers both the app and WebDriverAgent.
   - **Already installed:** skip `appium:app` and set `appium:bundleId` instead.
5. **Mock host.** The simulator shares the host's network, so the backend base URL is
   `http://127.0.0.1:18113` (the mock server's port). A **real device** must reach your Mac by
   its LAN IP instead — bind the mock with `host: "0.0.0.0"` so both ends use the same interface.

## Writing tests

### Test blocks (`describe` / `test`)

`test.describe(title, role?, body)` opens a scenario for a role; each `test(name, fn)` is one
behaviour with the app's fixture context injected — fully typed, no setup/teardown in the spec:

```ts
import { test, expect } from "../nativeproof.config";

test.describe("chat room", "member", () => {
  test("opens the room", async ({ member }) => {
    await expect(member.messages).toBeVisible();
  });

  test("signs out", async ({ member }) => {
    await member.signOut.tap();
  });
});

// role is optional — omit it for the default session
test.describe("home screen", () => {
  test("shows the start button", async ({ home }) => {
    await expect(home.start).toBeVisible();
  });
});
```

The destructured fixtures (`member`, `home`, `mock`, `driver`, …) are exactly the `screens` you
declared in `defineApp`, plus `mock` and `driver` — typed to your app.

> **Where imports come from:** specs import **`test` / `expect`** from your
> `nativeproof.config.ts` (the typed pair `createHarness` returns). Everything else —
> `page`, `by`, the gesture helpers (`swipe` / `tapAt`), `captureState`, and the types —
> imports from the **`nativeproof`** package directly.

### Fixtures, roles & the app seam

A scenario's context is provisioned **once** before its behaviours and torn down **once** after
(the analogue of a Playwright scoped fixture / `describe.serial`) — so a single sign-in underpins
many ordered checks instead of re-logging-in per test. The order is: `driver` → `mock` →
`login(role)` → `join(role)` → build `screens`.

The **role** string from `test.describe(title, role, …)` flows into `login`/`join`, so one app
definition drives many roles:

```ts
const app = defineApp({
  driver: () => wdioDriver(),
  mock: () => startMockServer({ port: 18113, host: "0.0.0.0" }),
  secrets: [/\b\d{6}\b/], // e.g. a 6-digit OTP — redacted from evidence

  // runs once per describe, before screens are built:
  login: async ({ driver, role }) => {
    const p = page(driver);
    await p.getByTestId("email").fill(`${role}@example.com`); // taps to focus, then types
    await p.getByRole("button", { name: "Sign in" }).tap();
  },

  // enters the role's main surface after login:
  join: async ({ driver, role }) => {
    if (role === "member") await page(driver).getByText("My rooms").tap();
  },

  screens: {
    member: ({ driver }) => ({ messages: page(driver).getByTestId("message-list") }),
    guest: ({ driver }) => ({ banner: page(driver).getByTestId("signup-banner") }),
  },
});
```

```ts
test.describe("a signed-in member", "member", () => { /* uses { member, mock } */ });
test.describe("a guest", "guest", () => { /* uses { guest, mock } */ });
```

> NativeProof locators **read, tap and fill** (text entry). For input `fill()` doesn't cover
> (clearing a field first, custom keyboards, key chords), drive WebdriverIO's `$(...).setValue(...)`
> directly inside `login` (the `@wdio/globals` `browser`/`$` are available in the live session).

### Locators

Build locators by intent; NativeProof maps each to the right native attribute per platform — so
you address elements the way a person describes them, not by `content-desc` vs `name`:

```ts
const p = page(driver);
p.getByText("Sign in");                  // visible text
p.getByTestId("login-button");           // your test id
p.getByLabel("Sign out");                // accessibility label
p.getById("message-list");               // resource id
p.getByRole("button", { name: "Send" }); // accessible name (role is advisory on native)
p.locator(by.desc("Open menu"));         // escape hatch: a raw selector
```

How each maps to the page source:

| Locator | Android attribute | iOS attribute |
|---|---|---|
| `getByText` / `by.text` | `text` or `content-desc` | `label` or `value` |
| `getByLabel` / `by.label` / `getByRole({name})` | `content-desc` | `label` |
| `getByTestId` / `by.testId` | `resource-id` | `name` |
| `getById` / `by.id` | `resource-id` | `name` |
| `by.desc` | `content-desc` | `name` |

> **`getByText` is forgiving.** A visible label surfaces as `text` *or* `content-desc` on Android
> (Jetpack Compose) and as `label` *or* `value` on iOS (SwiftUI), so `getByText` / `by.text` finds
> the label wherever the toolkit put it — not just the node's own `text`. Reach for `getByLabel` /
> `by.desc` when you specifically want the accessibility description.

A `Locator` is a lazy, awaitable handle with built-in waiting:

```ts
await member.messages.isVisible();      // boolean, no waiting
await member.roomTitle.textContent();   // the node's own text, or null
await member.spinner.waitFor();         // wait until visible (throws on timeout)
await member.sendButton.tap();          // wait for it, then tap its centre
await member.sendButton.tap({ timeout: 2_000, interval: 100 }); // tune the wait
await member.row.tap({ clickableAncestor: true }); // tap the clickable parent of a non-clickable label
await member.composer.fill("Hello team"); // focus the field (tap), then type
```

`tap()` resolves the element's bounds from the page source and taps the centre — a coordinate
tap that works even on Compose / SwiftUI nodes Appium reports as non-clickable.

On Compose / SwiftUI the visible label often sits on a **non-clickable** child of the real touch
target (a list row, a card). `tap({ clickableAncestor: true })` taps the smallest
`clickable="true"` ancestor that fully contains the matched node instead of the node's own centre,
falling back to the node itself when nothing clickable wraps it.

`fill(text, opts?)` focuses the field with a `tap()` and types `text` through the device keyboard
— the native analogue of Playwright's `locator.fill()`. It types into the focused field and does
**not** clear existing content first; it needs a driver with text input (the bundled `wdioDriver()`
has it) and throws a clear error otherwise. `opts` is the same `{ timeout?, interval? }` as `tap()`.

### Assertions

Assertions **auto-wait** (poll until the condition holds or the timeout elapses, default
**10s** / 250ms interval), accept a string or `RegExp`, and `.not` inverts:

```ts
await expect(member.messages).toBeVisible();
await expect(member.messages).toShow("Welcome to the room");   // present + text anywhere on screen
await expect(member.roomTitle).toHaveText(/Room: \w+/);        // the node's OWN text (substring or regex)
await expect(member.spinner).not.toBeVisible({ timeout: 5_000 });
```

- `toBeVisible(opts?)` — the selector matches a node in the source.
- `toShow(text, opts?)` — the selector is present **and** `text` appears in the source.
- `toHaveText(text, opts?)` — the matched node's **own** text contains / matches `text`.
- `opts` is `{ timeout?, interval? }` (ms).

**Value matchers** — `expect(value)` also takes a plain value, for the non-UI assertions a spec
still needs (counts, ids, parsed payloads). The locator and mock matchers auto-wait and return
promises; value matchers assert a value you already have, so they are **synchronous** (no `await`)
and `.not` inverts:

```ts
const frames = await mock.frames();

expect(2 + 2).toBe(4);                          // strict identity (Object.is)
expect(frames).toContain(someFrame);            // membership (arrays) or substring (strings)
expect({ id: 7, name: "Ada" }).toEqual(user);   // deep structural equality
expect(member.unreadBadge).toBeTruthy();
expect(reply.error).toBeNull();
expect(reply.id).toBeDefined();
expect(reply.id).not.toBe(previousId);
```

- `toBe(expected)` — strict identity (`Object.is`).
- `toEqual(expected)` — deep structural equality.
- `toContain(expected)` — substring (for strings) or membership (for arrays).
- `toBeTruthy()` / `toBeFalsy()` / `toBeDefined()` / `toBeNull()` — value guards.

This keeps every assertion in a spec under one `expect`, so there's no second assertion library to
import for the checks the UI/traffic matchers don't cover.

### Network interception & assertions

The mock backend works like Playwright's `page.route()`. **Intercept** a path to control its
reply, and **assert** the traffic the app exchanged — over both REST and WebSocket:

```ts
test.describe("send failures", "member", () => {
  test("surfaces a rejected send", async ({ member, mock }) => {
    // Interception — routes apply to the next request/connect on that path:
    await mock.route("/messages").reject({ code: 503 }); // HTTP status, or WS close code (3000–4999)
    await member.sendButton.tap();
    await expect(member.errorBanner).toShow("Couldn't send message");
  });
});

test.describe("loading a room", "member", () => {
  test("renders history fetched on open", async ({ member, mock }) => {
    // fulfill answers the request/connect with a canned frame/body:
    await mock.route("/messages").fulfill({ type: "history", messages: ["Hello", "Hi there"] });
    await expect(member.messages).toShow("Hi there");
  });
});

test.describe("chat room", "member", () => {
  test("sends a message and receives the next one", async ({ mock }) => {
    // Assertions — matched by path + type + any payload field:
    await expect(mock).toHaveSent({ path: "/messages", type: "create" });     // a WS message
    await expect(mock).toHaveSent({ path: "/profile", type: "request", method: "GET" }); // a REST call
    await expect(mock).toHaveReceived({ path: "/messages", type: "new" });
    await expect(mock).not.toHaveSent({ type: "error" });
  });
});
```

- `mock.route(path).fulfill(frame)` — answer with a canned frame/body (WS connect reply or HTTP JSON).
- `mock.route(path).reject({ code })` — fail it (HTTP status, or WebSocket close code 3000–4999).
- `mock.route(path).abort()` — drop the connect/request entirely.
- `expect(mock).toHaveSent(match)` / `toHaveReceived(match)` — `match` is a partial frame:
  `path` / `type` plus any payload fields.

**Frame types** — real protocol messages keep their own `type` (a WS JSON message's `type`); the
server also synthesises types for primitives so you can assert on them:

| What the app did | Recorded as |
|---|---|
| Opened a WebSocket | `{ type: "open", direction: "sent" }` |
| Sent a WS JSON message | `{ type: <message.type>, direction: "sent", payload }` |
| Made an HTTP request | `{ type: "request", direction: "sent", payload: { method } }` |
| Got a fulfilled reply | `{ type: <frame.type ?? "response" | "message">, direction: "received" }` |

`startMockServer()` is a real HTTP + WebSocket server (`url` / `wsUrl`), so there's no per-app
adapter — your app just points at it. It can also push a server-initiated frame to open sockets
with `server.send(path, frame)` (useful for simulating an incoming message in a config-level helper).

### Bring your own backend

`startMockServer` is the batteries-included option, but `defineApp({ mock })` accepts **any**
`MockBackend`. An app with its own protocol (or an existing mock server) injects a small adapter
that exposes the three-method contract — then `route()` and the traffic assertions work unchanged:

```ts
import { defineApp, type MockBackend, type MockFrame, type MockRoute, wdioDriver } from "nativeproof";

function adapt(server: MyExistingMock): MockBackend {
  return {
    frames: async (): Promise<MockFrame[]> =>
      server.log.map((f) => ({
        path: f.path,
        type: f.kind,
        direction: f.outbound ? "sent" : "received",
        payload: f.body,
      })),
    route: (path: string): MockRoute => ({
      fulfill: (frame) => server.stub(path, frame),
      reject: ({ code }) => server.fail(path, code),
      abort: () => server.drop(path),
    }),
    stop: () => server.close(),
  };
}

const app = defineApp({
  driver: () => wdioDriver(),
  mock: () => adapt(startMyMock()),
  screens: {
    /* … */
  },
});
```

The framework depends only on the `MockBackend` interface, never a concrete server — so
`expect(mock).toHaveSent(...)` reads your backend's traffic with no other changes.

### Gestures & scrolling

For motion the locator layer doesn't cover (scrolling a list, swiping a carousel), use the
low-level pointer helpers — coordinates are in screen pixels:

```ts
import { swipe, tapAt, pause } from "nativeproof";

await swipe(540, 1500, 540, 500);  // drag up to scroll a feed down (fromX, fromY, toX, toY, duration=600)
await tapAt(540, 120);             // a raw coordinate tap
await pause(250);                  // idle (e.g. let an animation settle)
```

A common pattern: swipe until the target appears, then assert.

```ts
while (!(await member.messages.shows("Older message"))) {
  await swipe(540, 1500, 540, 600);
}
await expect(member.messages).toShow("Older message");
```

### Evidence & secrets

A passing mobile test should prove app state, not just "the runner didn't throw". Capture a
screenshot + a **redacted** page-source snapshot at any meaningful step:

```ts
import { captureState } from "nativeproof";

await member.sendButton.tap();
await captureState("after-send"); // writes .e2e-artifacts/after-send.png + after-send.xml (redacted)
```

- Artifacts land in `.e2e-artifacts/` (override with the `E2E_ARTIFACT_DIR` env var).
- Source is redacted before it touches disk: built-in patterns strip 4–8 digit values, `passcode`
  fields, and `Bearer` tokens; add your app's own patterns via `secrets` / `redact` in `defineApp`.

## Running

One command, in the spirit of `playwright test`:

```bash
nativeproof                          # auto-discovers nativeproof.config.ts, runs the suite
nativeproof --platform android       # or: --platform ios
nativeproof --project tablet         # a named project from nativeproof.config.ts
nativeproof --spec tests/chat.spec.ts
nativeproof --config wdio.conf.ts    # escape hatch: a raw WebdriverIO config
nativeproof --no-appium              # use an Appium server you started yourself
nativeproof --appium-host 10.0.0.5 --appium-port 4723   # point at a remote/farm Appium
nativeproof --help
```

`nativeproof` discovers `nativeproof.config.ts` (or falls back to a `wdio.conf.ts`), ensures an
Appium server is reachable (starting one with `--relaxed-security` unless `--no-appium`), and runs
the suite with `PLATFORM` / `SPEC` / `NATIVEPROOF_PROJECT` / `APPIUM_*` set for you. A device or
emulator must already be running — the mobile analogue of needing a display.

## CI

It's a normal WebdriverIO suite, so CI is one command — the only requirement is a device.

**Android (GitHub Actions, hardware-accelerated emulator):**

```yaml
jobs:
  android-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24 }
      - run: npm ci
      - run: npx appium driver install uiautomator2
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          script: npx nativeproof --platform android
```

**iOS (GitHub Actions, macOS runner + simulator):**

```yaml
jobs:
  ios-e2e:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24 }
      - run: npm ci
      - run: npx appium driver install xcuitest
      - run: xcrun simctl boot "iPhone 15" || true
      - run: npx nativeproof --platform ios
```

To offload either platform, point a project's Appium `host`/`port` (in `nativeproof.config.ts`,
or `nativeproof --appium-host/--appium-port`) at a **device farm** (BrowserStack, Sauce Labs,
Firebase Test Lab) — NativeProof is just Appium, so no test changes are needed.

The framework's own unit suite (`npm test`) needs **no device** and runs anywhere.

## Configuration

**`defineConfig({ ... })`**

| Field | Type | Default | What |
|---|---|---|---|
| `app` | `App` | — | the app under test (from `defineApp`) |
| `projects` | `DeviceProject[]` | — | device targets; each `{ name, platform, capabilities }` |
| `testDir` | `string` | `"tests"` | directory holding the specs |
| `testMatch` | `string` | `"**/*.spec.ts"` | glob within `testDir` |
| `appium` | `{ host?, port?, path? }` | `127.0.0.1` : `4723` `/wd/hub` | Appium connection |
| `mochaTimeout` | `number` | `240000` | per-test timeout (ms) |

**`defineApp({ ... })`** — the seam

| Field | Type | What |
|---|---|---|
| `driver` | `() => Driver` | acquire the device (e.g. `wdioDriver()`) |
| `mock` | `() => MockBackend` | start the mock backend (e.g. `startMockServer(...)`) |
| `screens` | `Record<string, factory>` | screen-object factories, bound to the device context |
| `login?` | `({ driver, mock, role }) => Promise` | reach a logged-in state for the role |
| `join?` | `({ driver, mock, role }) => Promise` | enter the role's main surface |
| `secrets?` | `RegExp[]` | patterns kept out of captured evidence |
| `redact?` | `RegExp[]` | extra evidence-redaction patterns |

**CLI flags & env**

| Flag | Env it sets | Default |
|---|---|---|
| `--platform <android\|ios>` | `PLATFORM` | — |
| `--project <name>` | `NATIVEPROOF_PROJECT` | first project |
| `--spec <glob>` | `SPEC` | all specs in `testDir` |
| `--config <path>` | — | auto-discovered |
| `--appium-host/-port/-path` | `APPIUM_HOST/PORT/PATH` | `127.0.0.1` / `4723` / `/wd/hub` |
| `--no-appium` | — | auto-start Appium |

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Appium is not reachable …` | No device, or `--no-appium` set without a server. Boot the emulator/simulator; drop `--no-appium` to let NativeProof start Appium. |
| `no nativeproof.config.ts or wdio.conf.ts found` | Run from the project root, or pass `--config <path>`. |
| "No specs found" | Specs must match `testDir`/`testMatch` (default `tests/**/*.spec.ts`), or pass `--spec`. |
| App can't reach the mock | Emulator → use `10.0.2.2`; real device → your machine's LAN IP. Bind the mock with `host: "0.0.0.0"`. |
| `expect(...)` times out | The selector never matched — confirm the attribute mapping (see the [Locators](#locators) table) and the value; raise `{ timeout }` for slow screens. |
| iOS first run hangs | WebDriverAgent is building/signing. Set `appium:wdaLaunchTimeout` and, on a real device, the signing capabilities. |

## API reference

- `defineApp(definition)` → `app` — the seam; `app.session(role?)` is a scenario fixture.
- `createHarness(app)` → `{ test, expect }` — typed, app-bound test surface.
- `defineConfig({ app, projects, testDir?, testMatch?, appium?, mochaTimeout? })` — the config the CLI runs.
- `by.text/desc/id/testId/label`, `page(driver).getByText/getByTestId/getByLabel/getById/getByRole`,
  `page(driver).locator(selector)`, `new Locator(driver, selector)` — locators
  (`isVisible`, `textContent`, `bounds`, `shows`, `waitFor`, `tap`, `fill` — `tap({ clickableAncestor })`
  for non-clickable labels).
- `expect(locator)` → `toBeVisible` / `toShow` / `toHaveText` (+ `.not`), each `(value?, { timeout?, interval? })`.
- `expect(mock)` → `toHaveSent` / `toHaveReceived` (+ `.not`), matched by partial frame.
- `expect(value)` → `toBe` / `toEqual` / `toContain` / `toBeTruthy` / `toBeFalsy` / `toBeDefined` / `toBeNull` (+ `.not`) — synchronous matchers for plain values.
- `startMockServer({ port?, host? })` → a `MockServer` (`url`, `wsUrl`, `route()`, `frames()`, `send()`, `stop()`).
- `swipe`, `tapAt`, `pause` — low-level pointer gestures.
- `captureState(prefix)` / `captureScreenshot` / `captureText` / `redactEvidenceText` — evidence.
- Device commands — **Android** (`adb`): `adbForceStop`, `resetAppAndBrowserState`, `adbTap`, `adbDump`, `adbLogcat*`; **iOS** (`simctl`): `iosTerminate`, `iosLaunch`, `iosInstall`, `iosUninstall`, `iosBoot`, `iosShutdown`, `resetAppState`, `iosLogShow`.
- `wdioDriver()` → the live `Driver`; `useRunner(hooks)` to host on a non-Mocha runner.

## How it works

The engine is Appium/WebdriverIO; NativeProof is the DX layer. It's app-agnostic by contract:
a consuming app injects all of its specifics through `defineApp`, and nothing in the package
imports app code (the dependency is one-way, app → framework). The whole DX self-verifies against
an in-memory fake device — see `test/demo.test.ts` and run `npm test` (no emulator needed).

Package layout: `app.ts` (`defineApp`), `harness.ts` (`createHarness`), `config.ts`
(`defineConfig`) + `runner-config.ts` (the wdio bridge), `fixtures.ts`, `locator.ts` +
`page.ts`, `expect.ts`, `mock.ts` + `mock-server.ts`, `driver.ts`, `runner.ts`, `cli.ts`
(the `nativeproof` bin), plus source/wait/gesture/adb/ios/log/evidence primitives.

## License

See [LICENSE](LICENSE).
