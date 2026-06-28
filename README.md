# NativeProof

A **Playwright-feeling native mobile E2E layer for Appium/WebdriverIO**. NativeProof brings Playwright's
developer experience — **runner-native `describe` / `it`, direct `native.*` interactions,
locators, auto-waiting `expect`, route-style network interception, fixtures, evidence capture** — to
**native iOS and Android** apps, layered on **Appium / WebdriverIO** (which can drive the
native surfaces Playwright itself cannot).

```ts
import { expect, native } from "./nativeproof.config";

describe("login", () => {
  it("should be able to log in", async () => {
    await native.navigate("/login");
    await native.tap("Log in");

    await expect(native.getByText("Welcome back")).toBeVisible();
  });
});
```

One command scaffolds the project, then one command runs it on a device or emulator:

```bash
npx nativeproof init --android
npm run test:e2e
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
  - [Test blocks](#test-blocks-describe--it)
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

- **Reads like a normal test** — runner-native `describe` / `it` / `expect`, with direct
  `native.navigate`, `native.tap`, and `native.getByText` calls in the spec.
- **Locators** — `by.text/testId/label/desc/id` and `page(driver).getByText/getByTestId/
  getByLabel/getById/getByRole`, each mapped to the right native attribute per platform (so you
  never guess `content-desc` vs `accessibilityIdentifier`), with built-in auto-waiting and
  `tap()` / `clear()` / `fill()` / `check()` for interaction. Each takes a string (exact) or a **`RegExp`**
  (`getByText(/Save( draft)?/)`); `.nth()` / `.first()` / `.last()` / `.count()` handle multiple matches.
- **Auto-waiting `expect`** — `expect(locator).toBeVisible()/toShow()/toHaveText()/toBeChecked()/
  toHaveCount()` and `.not`, each polling until the condition holds (default 10s); plus synchronous
  `expect(value)` matchers (`toBe`/`toEqual`/`toContain`/…) so non-UI checks need no second assertion library.
- **Network interception** — a first-party HTTP + WebSocket mock server with
  `route().fulfill/reject/abort` (like `page.route()`) and `expect(mock).toHaveSent()/
  toHaveReceived()` traffic assertions. No per-app adapter.
- **One config** — `nativeproof.config.ts` owns device projects, app paths, artifacts,
  Appium/WebdriverIO tuning, and any app-specific `native.navigate` / `native.launch` hooks.
- **Cross-platform** — the same spec runs on Android (UiAutomator2) and iOS (XCUITest).
- **One command** — `nativeproof` resolves your config, installs the missing Appium platform driver,
  ensures Appium is up, and runs the suite.
- **TypeScript-first**, strict, with evidence (redacted screenshots + page source) for an
  auditable green run.

## Requirements

- **Node.js ≥ 20**
- **Android:** Android SDK (platform-tools + emulator) and JDK 17
- **iOS:** macOS with Xcode + Command Line Tools
- Your native app project or a debug / E2E app artifact (`.apk` for Android, `.app` for iOS)

## Install

```bash
npm i -D nativeproof
```

## Quick start

Scaffold the starting files with one command, then onboard your app:

```bash
npx nativeproof init --android
# or
npx nativeproof init --ios

# same scaffold shortcut if you prefer an init-specific bin
npx nativeproof-init --android
npx nativeproof-init --ios

# point nativeproof.config.ts at your real app
npx nativeproof-onboard /path/to/ios-app-repo
npx nativeproof-onboard /path/to/app-debug.apk
npx nativeproof-onboard /path/to/MyApp.app
```

`nativeproof-onboard <path>` accepts an Android `.apk`, an iOS simulator `.app`, or a native app repo
directory. For iOS repos, NativeProof detects a top-level `.xcodeproj` / `.xcworkspace`, builds a
Debug simulator app, stages it under `./build/ios`, and updates `nativeproof.config.ts` so app
control stays in config. Android repo paths currently need a built `.apk` in the repo or a direct
`.apk` path.

On the first run, NativeProof installs the missing Appium driver for the selected platform before
starting Appium. For iOS generated projects, NativeProof uses the booted simulator when no
`appium:deviceName` or `appium:udid` is pinned in `nativeproof.config.ts`.

Then a few steps from zero to a green run on Android — or set it all up by hand:

**1. Configure** — one `nativeproof.config.ts` at the project root owns the app/device control:

```ts
import { createNative, defineConfig, expect, wdioDriver } from "nativeproof";

const driver = () => wdioDriver();

export const native = createNative({
  driver,
  async navigate(route) {
    if (route !== "/login") {
      throw new Error(`Configure native.navigate(${JSON.stringify(route)}) in nativeproof.config.ts`);
    }
    // Put app-specific deep links, reset flows, or mock-backend state here.
  },
});

export { expect };

export default defineConfig({
  testDir: "tests",
  artifacts: { dir: ".e2e-artifacts" },
  appium: {
    autoInstallDrivers: true,
    autoSelectBootedSimulator: true,
  },
  projects: [
    {
      name: "android",
      platform: "android",
      capabilities: {
        "appium:app": "/path/to/app-debug.apk",
        "appium:deviceName": "Android Emulator",
      },
    },
  ],
});
```

**2. Write a spec** — `tests/home.spec.ts`:

```ts
import { expect, native } from "../nativeproof.config";

describe("login", () => {
  it("should be able to log in", async () => {
    await native.navigate("/login");
    await native.tap("Log in");

    await expect(native.getByText("Welcome back")).toBeVisible();
  });
});
```

**3. Boot a device** — an emulator (Android) or simulator (iOS) must be running (see
[Android setup](#android-setup) / [iOS setup](#ios-setup)).

**4. Run:**

```bash
npm run test:e2e
```

`nativeproof` discovers the config, starts Appium if it isn't already up, and runs the suite.

## Project setup

Everything lives in one **`nativeproof.config.ts`** — the `playwright.config.ts` analogue. It
declares device projects, app paths, artifacts, Appium/WebdriverIO tuning, and the app-owned
`native.navigate` / `native.launch` hooks. Specs import `native` and `expect` from this file, while
`describe` / `it` stay runner-native. The CLI auto-discovers the config and synthesises the
WebdriverIO run, so there's no hand-written `wdio.conf.ts`.

A typical project:

```
my-app-e2e/
├─ nativeproof.config.ts  # the single config — native, device projects, artifacts
├─ package.json           # includes npm run test:e2e
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
import { createNative, defineConfig, expect, wdioDriver } from "nativeproof";

const driver = () => wdioDriver(); // the live WebdriverIO/Appium session

export const native = createNative({
  driver,
  async navigate(route) {
    // Keep app-specific routing here: deep links, reset flows, mock-backend state, etc.
    if (route !== "/login") {
      throw new Error(`Configure native.navigate(${JSON.stringify(route)}) in nativeproof.config.ts`);
    }
  },
});

// specs do:  import { expect, native } from "../nativeproof.config";
export { expect };

export default defineConfig({
  testDir: "tests",
  artifacts: { dir: ".e2e-artifacts" },
  appium: {
    autoInstallDrivers: true,
    autoSelectBootedSimulator: true,
  },
  projects: [
    {
      name: "android",
      platform: "android",
      capabilities: {
        "appium:app": "./app/build/outputs/apk/debug/app-debug.apk",
        "appium:deviceName": "Android Emulator",
      },
    },
    {
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:app": "./build/ios/MyApp.app",
      },
    },
  ],
});
```

> File names are conventions, not requirements. The important rule is that native app/device
> control lives in `nativeproof.config.ts`; NativeProof synthesises the WebdriverIO run from it.

## Android setup

1. **SDK & JDK.** Install Android Studio (or the command-line tools) and set:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"     # Linux: ~/Android/Sdk
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)"  # JDK 17
   ```
2. **Emulator.** Create an AVD (Android Studio → Device Manager, or `avdmanager`) and boot it:
   ```bash
   emulator -avd Pixel_7_API_34 -no-window -no-audio &
   adb wait-for-device
   adb devices            # should list the emulator
   ```
3. **App build.** Set `projects[].capabilities["appium:app"]` in `nativeproof.config.ts` to your
   debug/E2E `.apk` (or use `appium:appPackage` + `appium:appActivity` for an already-installed
   build).
4. **Mock host.** From an emulator, the host machine is reachable at **`10.0.2.2`** — build your
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
2. **Simulator.** List and boot one (Xcode → Settings → Components installs runtimes):
   ```bash
   xcrun simctl list devices            # names + UDIDs of installed simulators
   xcrun simctl boot "iPhone 16"        # or boot by UDID
   open -a Simulator                    # optional: watch it run
   ```
   Generated configs use the booted simulator automatically. Pin `appium:deviceName` or
   `appium:udid` only when you want a specific simulator/device.
3. **App build.**
   - **Simulator:** set `projects[].capabilities["appium:app"]` in `nativeproof.config.ts` to a
     simulator-built `.app` (an `arm64`/`x86_64` simulator binary, not a device build), e.g.
     `app/ios/MyApp.app`.
   - **Real device:** set `projects[].capabilities["appium:app"]` to a signed `.ipa`, set
     `appium:udid`, and use a provisioning profile that covers both the app and WebDriverAgent.
   - **Already installed:** skip `appium:app` and set `appium:bundleId` instead.
4. **Mock host.** The simulator shares the host's network, so the backend base URL is
   `http://127.0.0.1:18113` (the mock server's port). A **real device** must reach your Mac by
   its LAN IP instead — bind the mock with `host: "0.0.0.0"` so both ends use the same interface.

## Writing tests

### Test blocks (`describe` / `it`)

Use the runner's own `describe` / `it` / `beforeEach` / `describe.skip` words. NativeProof should
make native controls feel first-class inside those tests, not replace the runner:

```ts
import { expect, native } from "../nativeproof.config";

describe("login", () => {
  it("should be able to log in", async () => {
    await native.navigate("/login");
    await native.tap("Log in");

    await expect(native.getByText("Welcome back")).toBeVisible();
  });
});
```

Keep meaningful setup visible:

```ts
beforeEach(async () => {
  await native.launch({ route: "/login", reset: true });
});
```

> **Where imports come from:** specs import **`native` / `expect`** from your
> `nativeproof.config.ts`. Everything else — `page`, `by`, the gesture helpers (`swipe` / `tapAt`),
> `captureState`, and the types — imports from the **`nativeproof`** package directly.

For stateful flows where a fixture genuinely exposes intent better than visible setup, the lower-level
fixture APIs remain available. Keep them out of generated projects and first-read specs.

### Fixtures, roles & the app seam

This is the legacy/advanced compatibility surface for suites that already need shared scenario
fixtures. New specs should prefer runner-native `describe` / `it` with visible setup and direct
`native.*` calls.

A scenario's context is provisioned **once** before its behaviours and torn down **once** after
(the analogue of a Playwright scoped fixture / `describe.serial`) — so a single sign-in underpins
many ordered checks instead of re-logging-in per test. The order is: `driver` → `mock` →
`login(role)` → `join(role)` → build `screens`.

The **role** string from a harness scenario flows into `login`/`join`, so one app definition drives
many roles:

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

  // optional lifecycle hooks:
  teardown: async ({ driver }) => { /* release app resources before the session is deleted */ },
  onFailure: async (ctx, { title, error }) => { await captureState(`fail-${title}`); }, // evidence on any failed behaviour
});
```

```ts
test.describe("a signed-in member", "member", () => {
  test.beforeEach(async ({ member }) => { /* reset to a known state before each behaviour */ });
  test.afterEach(async ({ member }) => { /* per-behaviour cleanup, if any */ });
  test("renders the latest message", async ({ member, mock }) => { /* … */ });
});
test.describe("a guest", "guest", () => { /* uses { guest, mock } */ });
```

The session fixture is provisioned **once** per `describe` (the slow login + join) and shared across
its behaviours; `beforeEach` / `afterEach` run around each behaviour with the context injected — a
repeatable reset without per-spec boilerplate. `teardown` runs before the mock stops and the session
is deleted (e.g. force-stop the app); `onFailure` runs when a behaviour throws, before the failure
propagates, so on-failure evidence lives in one place instead of every behaviour.

If setup discovers that a scenario cannot run on the current native app build or device, call
`skipScenario(reason)` from the fixture. NativeProof marks the whole scenario skipped and still runs
`teardown(undefined)`, so app-owned seam checks stay in one fixture instead of leaking raw Mocha
`this.skip()` calls into specs:

```ts
import { skipScenario, type ScenarioFixture } from "nativeproof";

export function speechStallScenario(): ScenarioFixture<SpeechCtx> {
  return {
    async setup() {
      if (!process.env.WORDLY_E2E_PRESENTER_SPEECH_RESULT_STATE) {
        skipScenario("speech-result seam is not enabled for this app build");
      }
      return startSpeechSession();
    },
    async teardown(context) {
      await context?.mock.stop();
    },
  };
}
```

> NativeProof locators **read, tap, clear and fill** text entry. `fill()` is Playwright-style:
> it focuses the field, clears existing text, then types the replacement value. For custom
> keyboards or key chords, keep the low-level WebdriverIO call inside `nativeproof.config.ts`
> setup/control code instead of hiding it in a spec helper.

### Locators

Build locators by intent; NativeProof maps each to the right native attribute per platform — so
you address elements the way a person describes them, not by `content-desc` vs `name`:

```ts
const p = page(driver);
p.getByText("Sign in");                  // visible text
p.getByText(/Sign ?in/i);                // ...or a RegExp, matched against the element's decoded value
p.getByTestId("login-button");           // your test id
p.getByLabel("Sign out");                // accessibility label
p.getById("message-list");               // resource id
p.getByRole("button", { name: "Send" }); // role + accessible name
p.getByRole("checkbox");                 // by role/class — checkbox/switch/button/textfield/image
p.locator(by.desc("Open menu"));         // escape hatch: a raw selector
```

Every `getBy*` (and `by.*`) takes a **string** (exact match) or a **`RegExp`** (tested against the
element's decoded value), so a human pattern matches even entity-escaped source — `getByText(/Save( draft)?/)`,
`getByLabel(/^Remove /)`, `getByRole("checkbox", { name: /terms/i })`. The Playwright muscle memory carries over.

> **A string selector is exact — case-, space- and punctuation-sensitive.** `getByText("Sign In")`
> does **not** match a `Sign in` label; it just times out as "not found", with no hint that you were
> one capital letter away. When you don't yet know a label verbatim — porting an existing suite, or
> writing the spec before you've seen the screen — reach for a `RegExp` (`getByText(/sign in/i)`) or
> read the real label off the page source first (see [Troubleshooting](#troubleshooting)). A wrong
> guess fails the same way a genuinely-missing element does, so confirm the string against the device.

How each maps to the page source:

| Locator | Android attribute | iOS attribute |
|---|---|---|
| `getByText` / `by.text` | `text` or `content-desc` | `label` or `value` |
| `getByLabel` / `by.label` | `content-desc` | `label` |
| `getByRole(role, { name })` | widget `class` + own or in-bounds `content-desc`/`text` | XCUITest `type` + own or in-bounds `label`/`value` |
| `getByRole(role)` / `by.role` (no name) | widget `class` | XCUITest `type` |
| `getByTestId` / `by.testId` | `resource-id` | `name` |
| `getById` / `by.id` | `resource-id` | `name` |
| `by.desc` | `content-desc` | `name` |

> **`getByText` is forgiving.** A visible label surfaces as `text` *or* `content-desc` on Android
> (Jetpack Compose) and as `label` *or* `value` on iOS (SwiftUI), so `getByText` / `by.text` finds
> the label wherever the toolkit put it — not just the node's own `text`. Reach for `getByLabel` /
> `by.desc` when you specifically want the accessibility description.

> **Named roles understand split native labels.** Compose/SwiftUI can expose a button or text field's
> visible name on a child/sibling label while the semantic role lives on a separate role node with the
> same bounds. `getByRole("button", { name: "Search" })` and
> `getByRole("textfield", { name: /email/i })` match that common shape, while unrelated same-named
> text outside the control bounds is ignored.

A `Locator` is a lazy, awaitable handle with built-in waiting:

```ts
await member.messages.isVisible();      // boolean, no waiting
await member.roomTitle.textContent();   // the node's own text, or null
await member.spinner.waitFor();         // wait until visible (throws on timeout)
await member.sendButton.tap();          // wait for it, then tap its centre
await member.sendButton.tap({ timeout: 2_000, interval: 100 }); // tune the wait
await member.row.tap({ clickableAncestor: true }); // tap the clickable parent of a non-clickable label
await member.composer.clear();            // focus the field (tap), then clear existing text
await member.composer.fill("Hello team"); // focus, clear existing text, then type

await p.getByText("Item").count();       // how many elements match
await p.getByText("Item").nth(1).tap();  // the 2nd match (.first() / .last(); negative counts from the end)
await member.terms.check();              // checkbox/switch → tap to checked (no-op if already there); also uncheck()
await member.terms.isChecked();          // boolean
await p.getByRole("checkbox").near(p.getByText("Wi-Fi")).check(); // the checkbox in the Wi-Fi row

const AcceptAgreementCheckbox = p.getByRole("checkbox", { name: /Accept Agreement/ });
await AcceptAgreementCheckbox.check();
await expect(AcceptAgreementCheckbox).toBeChecked();
```

**Relative locators.** `getByRole(role)` matches by element class/type (`checkbox`, `switch`, `button`,
`textfield`, `image`), and `Locator.near(anchor, { maxDistance? })` scopes to the match nearest an
anchor's element — so a control beside a label is addressed by the label, not by coordinates:
`page(driver).getByRole("checkbox").near(page(driver).getByText("Wi-Fi"))`. Compose with `.check()` /
`expect(locator).toBeChecked()`.

Some iOS apps expose custom checkbox controls as `XCUIElementTypeButton` nodes rather than native
switches. If the accessible name identifies the node as a checkbox, `getByRole("checkbox")` still
matches it, and `toBeChecked()` understands iOS checked state from `value`, selected traits, and
checked/unchecked labels.

`tap()` resolves the element's bounds from the page source and taps the centre — a coordinate
tap that works even on Compose / SwiftUI nodes Appium reports as non-clickable.

On Compose / SwiftUI the visible label often sits on a **non-clickable** child of the real touch
target (a list row, a card). `tap({ clickableAncestor: true })` taps the smallest
`clickable="true"` ancestor that fully contains the matched node instead of the node's own centre,
falling back to the node itself when nothing clickable wraps it.

`clear(opts?)` focuses the field with a `tap()` and clears existing text. `fill(text, opts?)`
does the Playwright thing: focus, clear, then type replacement text through the device keyboard.
Both need a driver with focused text clearing and input (the bundled `wdioDriver()` has them) and
throw a clear error otherwise. `opts` is the same `{ timeout?, interval? }` as `tap()`.

### Assertions

Assertions **auto-wait** (poll until the condition holds or the timeout elapses, default
**10s** / 250ms interval), accept a string or `RegExp`, and `.not` inverts:

```ts
await expect(member.messages).toBeVisible();
await expect(member.messages).toShow("Welcome to the room");   // present + text anywhere on screen
await expect(member.roomTitle).toHaveText(/Room: \w+/);        // the node's OWN text (substring or regex)
await expect(member.terms).toBeChecked();                      // checkbox / switch is on
await expect(member.results).toHaveCount(3);                   // exactly 3 elements match
await expect(member.spinner).not.toBeVisible({ timeout: 5_000 });
```

- `toBeVisible(opts?)` — the selector matches a node in the source.
- `toShow(text, opts?)` — the selector is present **and** `text` appears in the source.
- `toHaveText(text, opts?)` — the matched node's **own** text contains / matches `text`.
- `toBeChecked(opts?)` — the matched checkbox / switch is checked (`checked="true"`).
- `toBeEnabled(opts?)` / `toBeDisabled(opts?)` — the matched element's `enabled` state. If the
  visible label is a non-clickable child inside a clickable control, NativeProof reads the
  clickable ancestor's state, so `expect(native.getByText("Search")).toBeDisabled()` follows the
  real button.
- `toHaveCount(n, opts?)` — exactly `n` elements match the selector.
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
import { expect, mock, native } from "../nativeproof.config";

describe("send failures", () => {
  it("surfaces a rejected send", async () => {
    // Interception — routes apply to the next request/connect on that path:
    mock.route("/messages").reject({ code: 503 }); // HTTP status, or WS close code (3000–4999)
    await native.tap("Send");
    await expect(native.getByText("Couldn't send message")).toBeVisible();
  });
});

describe("loading a room", () => {
  it("renders history fetched on open", async () => {
    // fulfill answers the request/connect with a canned frame/body:
    mock.route("/messages").fulfill({ type: "history", messages: ["Hello", "Hi there"] });
    await native.navigate("/rooms/general");
    await expect(native.getByText("Hi there")).toBeVisible();
  });
});

describe("chat room", () => {
  it("sends a message and receives the next one", async () => {
    await native.fill("Message", "Hello");
    await native.tap("Send");

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
  `path` / `type` plus any payload fields. Each field is a string (exact / deep-equal) **or a `RegExp`**
  (`toHaveSent({ path: /\/users/, type: "request" })`) to match a query-suffixed or variable path.

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
When specs need traffic assertions, export the mock handle from `nativeproof.config.ts` next to
`native` so the test still reads directly.

### Bring your own backend

`startMockServer` is the batteries-included option, but an app with its own protocol or an existing
mock server can export a small config-owned adapter that exposes the `MockBackend` contract — then
`route()` and the traffic assertions work unchanged:

```ts
import {
  createNative,
  defineConfig,
  expect,
  type MockBackend,
  type MockFrame,
  type MockRoute,
  wdioDriver,
} from "nativeproof";

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

export const mock = adapt(startMyMock());

export const native = createNative({
  driver: () => wdioDriver(),
  async navigate(route) {
    // Use route plus mock.url/mock.wsUrl to put the app in the state this test needs.
  },
});

export { expect };

export default defineConfig({
  projects: [{ name: "android", platform: "android", capabilities: { "appium:app": "./app.apk" } }],
});
```

The framework depends only on the `MockBackend` interface, never a concrete server — so
`expect(mock).toHaveSent(...)` reads your backend's traffic with no other changes.

> **Just need the assertions?** If your mock can't implement `route` / `stop` (e.g. it only writes a
> request/socket log), expose a frames-only **`FrameLog`** — `{ frames(): Promise<MockFrame[]> }`,
> which `MockBackend` extends — and pass *that* to `expect(...)`: `expect(traffic).toHaveSent({ path, type })`
> / `.toHaveReceived(...)` auto-wait over it, no `route`/`stop` needed.

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

- Artifacts land in `.e2e-artifacts/` by default; set `artifacts: { dir: "..." }` in
  `nativeproof.config.ts` to keep that control in config.
- Source is redacted before it touches disk: built-in patterns strip 4–8 digit values, `passcode`
  fields, and `Bearer` tokens; add your app's own patterns via `secrets` / `redact` in `defineApp`.

## Running

One command, in the spirit of `playwright test`:

```bash
nativeproof init --android          # scaffold config, package script and sample spec
nativeproof init --ios              # same, for an iOS project
nativeproof onboard /path/to/ios-app # build/stage iOS or update/scaffold config with an app artifact
nativeproof-init --android          # init-specific bin alias
nativeproof-init --ios              # init-specific bin alias
nativeproof-onboard /path/to/app.apk # onboard-specific bin alias
nativeproof                          # auto-discovers nativeproof.config.ts, runs the suite
nativeproof --platform android       # or: --platform ios
nativeproof --android                # shorthand for --platform android
nativeproof --ios                    # shorthand for --platform ios
nativeproof --project tablet         # a named project from nativeproof.config.ts
nativeproof --spec tests/chat.spec.ts
nativeproof --no-appium              # use an Appium server you started yourself
nativeproof --help
```

`nativeproof` discovers `nativeproof.config.ts`, installs the missing Appium platform driver when
NativeProof owns the local Appium server, ensures Appium is reachable (starting one with
`--relaxed-security` unless `--no-appium`), and runs the suite with `PLATFORM` / `SPEC` /
`NATIVEPROOF_PROJECT` set for you. Appium host/port/path and the auto-provisioning switches live in
`nativeproof.config.ts` under `appium`. A device or emulator must already be running — the mobile
analogue of needing a display.

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
      - run: xcrun simctl boot "iPhone 16" || true
      - run: npx nativeproof --platform ios
```

To offload either platform, point `appium.host` / `appium.port` in `nativeproof.config.ts` at a
**device farm** (BrowserStack, Sauce Labs, Firebase Test Lab) — NativeProof is just Appium, so no
test changes are needed.

The framework's own unit suite (`npm test`) needs **no device** and runs anywhere.

## Configuration

**`defineConfig({ ... })`**

| Field | Type | Default | What |
|---|---|---|---|
| `app` | `App` | — | optional fixture surface from `defineApp` |
| `projects` | `DeviceProject[]` | — | device targets; each `{ name, platform, capabilities }` |
| `testDir` | `string` | `"tests"` | directory holding the specs |
| `testMatch` | `string` | `"**/*.spec.ts"` | glob within `testDir` |
| `appium` | `{ host?, port?, path?, autoInstallDrivers?, autoSelectBootedSimulator? }` | local Appium, auto install/select on | Appium connection + setup control |
| `artifacts` | `{ dir? }` | `.e2e-artifacts` | screenshot/source output |
| `mochaTimeout` | `number` | `240000` | per-test timeout (ms) |

**`createNative({ ... })`** — direct spec control

| Field | Type | What |
|---|---|---|
| `driver` | `() => Driver` | acquire the device (e.g. `wdioDriver()`) |
| `navigate?` | `(route, { driver, native }) => Promise` | app-owned route/deep-link/reset hook |
| `launch?` | `(options, { driver, native }) => Promise` | optional app launch/reset hook for visible setup |

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
| `--no-appium` | — | auto-start Appium |

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Appium is not reachable …` | No device, or `--no-appium` set without a server. Boot the emulator/simulator; drop `--no-appium` to let NativeProof start Appium. |
| Appium driver install fails | NativeProof tried to install `uiautomator2`/`xcuitest` and the host toolchain is missing or offline. Fix the Android SDK/Xcode issue, or run `npx appium driver install <driver>` yourself and retry. |
| `no nativeproof.config.ts found` | Run from the project root, or run `nativeproof init --ios` / `nativeproof init --android`. |
| "No specs found" | Specs must match `testDir`/`testMatch` (default `tests/**/*.spec.ts`), or pass `--spec`. |
| App can't reach the mock | Emulator → use `10.0.2.2`; real device → your machine's LAN IP. Bind the mock with `host: "0.0.0.0"`. |
| `expect(...)` times out | The selector never matched — confirm the attribute mapping (see the [Locators](#locators) table) and the **exact** value (see below); raise `{ timeout }` for slow screens. |
| iOS first run hangs | WebDriverAgent is building/signing. Set `appium:wdaLaunchTimeout` and, on a real device, the signing capabilities. |

**A selector won't match? Read the source — don't re-guess.** A string that's off by a capital letter,
a trailing space, or `(1)` vs ` (1)` fails as a silent timeout, identical to a genuinely-absent element.
The fix is always the same: look at what the device actually exposes.

- On any failure, the `onFailure` hook / `captureState(prefix)` writes the page source to your artifacts
  dir. Grep it for the real label: `grep -oE 'text="[^"]+"' <file>` and `content-desc="…"` on Android,
  `label="…"` / `value="…"` on iOS — then match it exactly, or with a `RegExp` if it varies.
- Or read it live mid-spec: `console.log(await wdioDriver().source())`.

This one-step loop — *fail → read the real attribute → match it* — is behind most "element not found"
mysteries, and it beats guessing label strings every time.

## API reference

- `createNative({ driver, navigate?, launch? })` → `native` — the direct control surface for
  runner-native specs: `native.navigate`, `native.launch`, `native.tap`, `native.fill`, and
  `native.getByText/getByTestId/getByLabel/getById/getByRole`.
- `defineApp(definition)` → `app` — the fixture seam; `app.session(role?)` is a scenario fixture. `definition` also
  takes optional `teardown(ctx)` (before mock stop / session delete) and `onFailure(ctx, { title, error })`.
- `createHarness(app)` → `{ test, expect }` — legacy/advanced fixture harness for existing suites
  that need a shared scenario context. Do not use it in generated projects; prefer runner-native
  `describe` / `it` and visible setup.
- `defineConfig({ projects, testDir?, testMatch?, appium?, artifacts?, mochaTimeout? })` — the config the CLI runs.
  `app` is optional for fixture-heavy suites.
- `by.text/desc/id/testId/label` (string **or** `RegExp`), `page(driver).getByText/getByTestId/getByLabel/getById/getByRole`,
  `page(driver).locator(selector)`, `new Locator(driver, selector)` — locators
  (`isVisible`, `textContent`, `bounds`, `shows`, `waitFor`, `tap`, `clear`, `fill`, `isChecked`, `check`, `uncheck`,
  `count`, `nth`, `first`, `last` — `tap({ clickableAncestor })` for non-clickable labels).
- `expect(locator)` → `toBeVisible` / `toShow` / `toHaveText` / `toBeChecked` / `toHaveCount` (+ `.not`), each `(value?, { timeout?, interval? })`.
- `expect(mock | frameLog)` → `toHaveSent` / `toHaveReceived` (+ `.not`), matched by partial frame; accepts any `FrameLog` (`{ frames() }`).
- `expect(value)` → `toBe` / `toEqual` / `toContain` / `toBeTruthy` / `toBeFalsy` / `toBeDefined` / `toBeNull` (+ `.not`) — synchronous matchers for plain values.
- `skipScenario(reason)` — call from a `ScenarioFixture.setup()` precondition to skip every behaviour in that scenario while still running teardown.
- `startMockServer({ port?, host? })` → a `MockServer` (`url`, `wsUrl`, `route()`, `frames()`, `send()`, `stop()`).
- `swipe`, `tapAt`, `pause` — low-level pointer gestures.
- `captureState(prefix)` / `captureScreenshot` / `captureText` / `redactEvidenceText` — evidence.
- Device commands — **Android** (`adb`): `adbForceStop`, `resetAppAndBrowserState`, `adbTap`, `adbDump`, `adbLogcat*`; **iOS** (`simctl`): `iosTerminate`, `iosLaunch`, `iosInstall`, `iosUninstall`, `iosBoot`, `iosShutdown`, `resetAppState`, `iosLogShow`.
- `wdioDriver()` → the live `Driver`; `useRunner(hooks)` to host on a non-Mocha runner.

## How it works

The engine is Appium/WebdriverIO; NativeProof is the DX layer. It's app-agnostic by contract:
a consuming app keeps all specifics in `nativeproof.config.ts` through `createNative` and, where useful,
`defineApp`; nothing in the package imports app code (the dependency is one-way, app → framework).
The whole DX self-verifies against
an in-memory fake device — see `test/demo.test.ts` and run `npm test` (no emulator needed).

Package layout: `native.ts` (`createNative`), `app.ts` (`defineApp`), `harness.ts` (legacy fixture harness), `config.ts`
(`defineConfig`) + `runner-config.ts` (the wdio bridge), `fixtures.ts`, `locator.ts` +
`page.ts`, `expect.ts`, `mock.ts` + `mock-server.ts`, `driver.ts`, `runner.ts`, `cli.ts`
(the `nativeproof` bin), plus source/wait/gesture/adb/ios/log/evidence primitives.

## License

See [LICENSE](LICENSE).
