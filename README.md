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
- [Project setup](#project-setup)
- [Android setup](#android-setup)
- [iOS setup](#ios-setup)
- [Writing tests](#writing-tests)
  - [Test blocks](#test-blocks-describe--test)
  - [Locators & assertions](#locators--assertions)
  - [Network interception & assertions](#network-interception--assertions)
- [Running](#running)
- [CI](#ci)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [How it works](#how-it-works)

---

## Features

- **Reads like Playwright** — `test.describe` / `test(...)` blocks with a typed fixture
  context injected; no per-test setup/teardown in the spec.
- **Locators** — `by.text/testId/label/desc/id` and `page(driver).getByText/getByTestId/
  getByLabel/getByRole`, mapped to the right native attribute per platform (so you never
  guess `content-desc` vs `accessibilityIdentifier`).
- **Auto-waiting `expect`** — `expect(locator).toBeVisible()/toShow()/toHaveText()` and
  `.not`, each polling until the condition holds.
- **Network interception** — a first-party mock server with `route().fulfill/reject/abort`
  (like `page.route()`) and `expect(mock).toHaveSent()/toHaveReceived()` traffic assertions.
  No per-app adapter.
- **One seam, by injection** — a single `defineApp(...)` declares the device, mock,
  login flow, screens and secret patterns; the core imports nothing app-specific.
- **Cross-platform** — the same spec runs on Android (UiAutomator2) and iOS (XCUITest).
- **One command** — `nativeproof` resolves your config, ensures Appium is up, and runs the suite.
- **TypeScript-first**, strict, with evidence (redacted screenshots + source) on every step.

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
```

A typical project:

```
my-app-e2e/
├─ nativeproof.config.ts  # the single config — app, device projects, test/expect exports
├─ tests/
│  └─ chat.spec.ts
└─ app/
   ├─ android/app-debug.apk
   └─ ios/MyApp.app
```

## Project setup

Everything lives in one **`nativeproof.config.ts`** — the `playwright.config.ts` analogue. It
declares the app (the injected seam), exports the typed `test` / `expect` your specs import,
and lists the device **projects**. The `nativeproof` CLI auto-discovers it and synthesises the
WebdriverIO run, so there's no hand-written `wdio.conf.ts`.

```ts
// nativeproof.config.ts
import { createHarness, defineApp, defineConfig, page, startMockServer, wdioDriver } from "nativeproof";

const app = defineApp({
  driver: () => wdioDriver(),                       // the live WebdriverIO/Appium session
  mock: () => startMockServer({ port: 18113 }),     // first-party mock; route()/frames built in
  secrets: [/\b2468\b/],                            // kept out of captured evidence
  login: async ({ role, mock }) => {
    // drive your app's sign-in; `mock` is the running backend, `role` comes from the describe
  },
  screens: {
    member: ({ driver }) => {
      const p = page(driver);
      return {
        messages: p.getByTestId("message-list"),
        signOut: p.getByLabel("Sign out"),
        sendButton: p.getByRole("button", { name: "Send" }),
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
5. **Mock host.** From the emulator, the host machine is reachable at **`10.0.2.2`**. Build
   your E2E app so its backend base URL is `http://10.0.2.2:18113` (the mock server's port),
   so `mock.route(...)` and `expect(mock)` see the app's traffic.

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
   its LAN IP instead, e.g. `http://192.168.1.20:18113` — set the mock's `host` so both bind
   the same interface.

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

The destructured fixtures (`member`, `home`, `mock`, …) are exactly the `screens` you
declared in `defineApp`, plus `mock` and `driver` — typed to your app.

### Locators & assertions

Build locators by intent; NativeProof maps each to the right native attribute per platform:

```ts
page(driver).getByText("Sign in");                 // Android text / iOS label
page(driver).getByTestId("login-button");          // Android resource-id / iOS accessibilityIdentifier
page(driver).getByLabel("Sign out");               // Android content-desc / iOS label
page(driver).getByRole("button", { name: "Send" });// accessible-name match (role is advisory on native)
```

Assertions auto-wait (poll until the condition holds or the timeout elapses), and `.not` inverts:

```ts
await expect(member.messages).toBeVisible();
await expect(member.messages).toShow("Welcome to the room");        // visible + text present
await expect(member.roomTitle).toHaveText(/Room: \w+/);
await expect(member.spinner).not.toBeVisible({ timeout: 5_000 });
await member.signOut.tap();                                         // waits, then taps
```

### Network interception & assertions

The mock backend works like Playwright's `page.route()`. **Intercept** a path to control its
reply, and **assert** the traffic the app exchanged:

```ts
test.describe("send failures", "member", () => {
  test("surfaces a rejected send", async ({ member, mock }) => {
    // Interception — control how a path replies (routes apply to the next request/connect):
    await mock.route("/messages").reject({ code: 4 });         // or .fulfill({ ... }) / .abort()
    await member.sendButton.tap();
    await expect(member.errorBanner).toShow("Couldn't send message");
  });
});

test.describe("chat room", "member", () => {
  test("sends a message and receives the next one", async ({ mock }) => {
    // Assertion — what the app sent / received, matched by path + type + payload fields:
    await expect(mock).toHaveSent({ path: "/messages", type: "create" });
    await expect(mock).toHaveReceived({ path: "/messages", type: "new" });
    await expect(mock).not.toHaveSent({ type: "error" });
  });
});
```

- `mock.route(path).fulfill(frame)` — answer the request/connect with a canned frame/body.
- `mock.route(path).reject({ code })` — fail it (WS close / HTTP status).
- `mock.route(path).abort()` — drop it.
- `expect(mock).toHaveSent(match)` / `toHaveReceived(match)` — `match` is a partial frame
  (`path`/`type` plus any payload fields).

`startMockServer()` is a real HTTP + WebSocket server, so no per-app adapter is needed — your
app just points at its `url` / `wsUrl`.

## Running

One command, in the spirit of `playwright test`:

```bash
nativeproof                          # auto-discovers nativeproof.config.ts, runs the suite
nativeproof --platform android       # or: --platform ios
nativeproof --project tablet         # a named project from nativeproof.config.ts
nativeproof --spec tests/chat.spec.ts
nativeproof --config wdio.conf.ts    # escape hatch: a raw WebdriverIO config
nativeproof --no-appium              # use an Appium server you started yourself
nativeproof --help
```

`nativeproof` discovers `nativeproof.config.ts` (or falls back to a `wdio.conf.ts`), ensures an
Appium server is reachable (starting one unless `--no-appium`), and runs the suite with
`PLATFORM` / `SPEC` / `NATIVEPROOF_PROJECT` / `APPIUM_*` set. A device or emulator must already
be running — the mobile analogue of needing a display.

## CI

It's a normal WebdriverIO suite, so CI is one command — the only requirement is a device.

**Android (GitHub Actions, hardware-accelerated emulator):**

```yaml
jobs:
  android-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx appium driver install uiautomator2
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          script: npx nativeproof --platform android
```

**iOS** runs the same way on a `macos-latest` runner (Xcode + a booted simulator), with
`npx nativeproof --platform ios`. To offload either platform, point a project's Appium
`host`/`port` (in `nativeproof.config.ts`, or `nativeproof --appium-host/--appium-port`) at a
**device farm** (BrowserStack, Sauce Labs, Firebase Test Lab) — NativeProof is just Appium, so
no test changes are needed.

The framework's own unit suite (`npm test`) needs **no device** and runs anywhere.

## Configuration

| Where | What |
|---|---|
| `nativeproof.config.ts` | `defineConfig({...})`: the `app`, device `projects`, `testDir`, `appium`, and the `test`/`expect` exports. |
| `defineApp({...})` | The seam: `driver`, `mock`, `login`, `join`, `screens`, `secrets`, `redact`. |
| `nativeproof` flags | `--platform`, `--project`, `--spec`, `--config`, `--appium-host/port/path`, `--no-appium`. |
| Env | `PLATFORM`, `NATIVEPROOF_PROJECT`, `SPEC`, `APPIUM_HOST/PORT/PATH` (set by the CLI; read by the synthesised config). |

## API reference

- `defineApp(definition)` → `app` — the seam; `app.session(role?)` is a fixture.
- `createHarness(app)` → `{ test, expect }` — typed, app-bound test surface.
- `defineConfig({ app, projects, testDir?, appium? })` — the `nativeproof.config.ts` the CLI runs.
- `by.text/testId/label/desc/id`, `page(driver).getByText/getByTestId/getByLabel/getById/getByRole`,
  `new Locator(driver, selector)` — locators (`isVisible`, `textContent`, `tap`, `waitFor`, …).
- `expect(locator)` → `toBeVisible` / `toShow` / `toHaveText` (+ `.not`).
- `expect(mock)` → `toHaveSent` / `toHaveReceived` (+ `.not`).
- `startMockServer({ port?, host? })` → a `MockBackend` with `route()`, `frames()`, `send()`.
- Device commands — **Android** (`adb`): `adbForceStop`, `resetAppAndBrowserState`, `adbTap`, `adbDump`, `adbLogcat*`; **iOS** (`simctl`): `iosTerminate`, `iosLaunch`, `iosInstall`, `iosUninstall`, `iosBoot`, `iosShutdown`, `resetAppState`, `iosLogShow`.
- `wdioDriver()` → the live `Driver`; `useRunner(hooks)` to host on a non-Mocha runner.

## How it works

The engine is Appium/WebdriverIO; NativeProof is the DX layer. It's app-agnostic by contract:
a consuming app injects all of its specifics through `defineApp`, and nothing in the package
imports app code (dependency is one-way, app → framework). The whole DX self-verifies against
an in-memory fake device — see `test/demo.test.ts` and run `npm test` (no emulator needed).

Package layout: `app.ts` (`defineApp`), `harness.ts` (`createHarness`), `config.ts`
(`defineConfig`) + `runner-config.ts` (the wdio bridge), `fixtures.ts`, `locator.ts` +
`page.ts`, `expect.ts`, `mock.ts` + `mock-server.ts`, `driver.ts`, `runner.ts`, `cli.ts`
(the `nativeproof` bin), plus source/wait/gesture/adb/log/evidence primitives.

## License

See [LICENSE](LICENSE).
