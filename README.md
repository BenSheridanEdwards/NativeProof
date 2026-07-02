# NativeProof

Playwright-feeling native mobile E2E for **iOS and Android**.

NativeProof is a thin test experience over Appium/WebdriverIO. You keep the runner words you already
know (`describe`, `it`, `expect`), write direct `native.*` interactions, and keep app/device control
inside one `nativeproof.config.ts`.

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

## Install

```bash
npm i -D nativeproof
```

Requirements:

- Node.js 20+
- Android: Android SDK, platform tools, emulator, JDK 17
- iOS: macOS, Xcode, Command Line Tools
- A booted emulator/simulator, unless your config points at an existing Appium/device-farm target

## Quick Start

Pick iOS or Android, then point NativeProof at the app you actually have.

### iOS

From an iOS source checkout with a top-level `.xcodeproj` or `.xcworkspace`:

```bash
npx nativeproof init --ios
npx nativeproof onboard /path/to/ios-app-repo
# wire native.navigate(...) in nativeproof.config.ts and edit tests/example.spec.ts
npx nativeproof --ios
```

What happens:

- NativeProof asks Xcode for shared schemes.
- It chooses the app-like scheme.
- It builds a Debug simulator app.
- It stages the newest `.app` at `./build/ios/<AppName>.app`.
- It writes that staged path into `nativeproof.config.ts`.

From a simulator `.app` your app pipeline already built:

```bash
npx nativeproof init --ios
npx nativeproof onboard /path/to/MyApp.app
# wire native.navigate(...) in nativeproof.config.ts and edit tests/example.spec.ts
npx nativeproof --ios
```

### Android

From a debug or E2E `.apk`:

```bash
npx nativeproof init --android
npx nativeproof onboard /path/to/app-debug.apk
# wire native.navigate(...) in nativeproof.config.ts and edit tests/example.spec.ts
npx nativeproof --android
```

Android repo builds are app-owned for now. Build the APK with your app's Gradle setup, then onboard
the artifact.

## What Init Creates

```text
nativeproof.config.ts
tests/example.spec.ts
package.json
```

`nativeproof.config.ts` owns the app path, device selection, Appium settings, artifacts, and
app-specific navigation/setup hooks.

```ts
import { createNative, defineConfig, expect, wdioDriver } from "nativeproof";

export const native = createNative({
  driver: () => wdioDriver(),
  async navigate(route) {
    if (route !== "/login") {
      throw new Error(`Configure native.navigate(${JSON.stringify(route)}) in nativeproof.config.ts`);
    }
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
      name: "ios",
      platform: "ios",
      capabilities: {
        "appium:app": "./build/ios/MyApp.app",
      },
    },
    {
      name: "android",
      platform: "android",
      capabilities: {
        "appium:app": "./app/build/outputs/apk/debug/app-debug.apk",
        "appium:deviceName": "Android Emulator",
      },
    },
  ],
});
```

## Test Style

Tests should read like Jest + React Testing Library or Playwright. Keep setup visible. Do not hide
interactions and assertions behind app-specific helpers.

Good:

```ts
it("should accept the agreement", async () => {
  const AcceptAgreementCheckbox = native.getByRole("checkbox", { name: /Accept Agreement/ });
  const AcceptButton = native.getByRole("button", { name: "Accept" });

  await AcceptAgreementCheckbox.check();
  await expect(AcceptAgreementCheckbox).toBeChecked();
  await AcceptButton.tap();
});
```

Avoid:

```ts
await acceptTerms();
expectTermsAccepted();
```

### Locators

Every locator takes an exact string or a RegExp:

```ts
native.getByText("Welcome back");
native.getByText(/welcome back/i);
native.getByRole("button", { name: "Log in" });     // roles: button, checkbox, switch, textfield, image
native.getByRole("checkbox", { name: /Accept Agreement/ });
native.getByLabel("Email");                          // accessibility label
native.getByTestId("login-button");                  // resource-id / accessibilityIdentifier
native.getById("message-list");
```

Narrow multiple matches by position or proximity:

```ts
native.getByText("Delete").first();
native.getByText("Delete").last();
native.getByText("Delete").nth(1);                  // 0-based; negative counts from the end
await native.getByText("Item").count();             // how many match right now

// The relative locator for native layouts: the switch in the Wi-Fi row.
native.getByRole("switch").near(native.getByText("Wi-Fi"));
native.getByRole("switch").near(native.getByText("Wi-Fi"), { maxDistance: 200 });
```

### Interactions

Every interaction auto-waits for its element:

```ts
await native.tap("Log in");                                       // tap by visible text
await native.getByText("Advanced").tap({ clickableAncestor: true }); // tap the real touch target around a label
await native.getByRole("button", { name: "Hold to talk" }).press({ duration: 1500 });

await native.getByRole("textfield").fill("me@example.com");       // replaces the current value (clear + type)
await native.getByRole("textfield").clear();
await native.fill("Email", "me@example.com");                     // field found by its visible text

await native.getByRole("checkbox", { name: /Terms/ }).check();    // no-op if already checked
await native.getByRole("checkbox", { name: /Terms/ }).uncheck();

await native.getByText("Dashboard").waitFor();                    // explicit wait, throws on timeout
```

### Assertions

Every matcher polls until it holds or times out; `.not` inverts:

```ts
await expect(native.getByText("Welcome back")).toBeVisible();
await expect(native.getByText("Spinner")).not.toBeVisible();
await expect(native.getByRole("button", { name: "Accept" })).toBeEnabled();
await expect(native.getByRole("button", { name: "Submit" })).toBeDisabled();
await expect(native.getByRole("checkbox", { name: /Accept Agreement/ })).toBeChecked();
await expect(native.getByTestId("greeting")).toHaveText(/Welcome, \w+/);
await expect(native.getByText("Item")).toHaveCount(3);
await expect(native.getByText("Cart")).toShow("2 items"); // element present AND text on screen
```

When a locator finds nothing, the error names the closest on-screen candidates:

```text
by.text("Login") did not become visible within 10000ms — did you mean "Log in", "Log in help"?
```

## Mocking And Backend Setup

NativeProof includes a small HTTP/WebSocket mock server and traffic assertions, but your app must be
able to point at it.

Keep that control in `nativeproof.config.ts`:

```ts
import { createNative, defineConfig, expect, startMockServer, wdioDriver } from "nativeproof";

export const mock = await startMockServer({ port: 18113, host: "0.0.0.0" });

export const native = createNative({
  driver: () => wdioDriver(),
  async navigate(route) {
    // Deep link, reset app state, or prepare mock state here.
  },
});

export { expect };

export default defineConfig({
  projects: [
    {
      name: "ios",
      platform: "ios",
      capabilities: { "appium:app": "./build/ios/MyApp.app" },
    },
  ],
});
```

Control replies per path and assert on traffic, Playwright-style:

```ts
// In a spec — mock is exported from nativeproof.config.ts:
mock.route("/api/login").fulfill({ status: "ok", token: "t-123" });
mock.route("/api/flaky").reject({ code: 503 });
mock.route("/api/dead").abort();

await native.tap("Log in");

await expect(mock).toHaveSent({ path: /\/api\/login/ });        // the app called the backend
await expect(mock).toHaveReceived({ type: "response" });         // and got the mocked reply
mock.send("/feed", { type: "announcement", body: "hi" });        // push a server-initiated WS frame
```

Device host rules:

- iOS simulator: use `http://127.0.0.1:<port>`.
- Android emulator: use `http://10.0.2.2:<port>`.
- Real device: use your machine's LAN IP and bind mocks to `0.0.0.0`.

## Commands

```bash
npx nativeproof init --ios
npx nativeproof init --android

npx nativeproof onboard /path/to/ios-app-repo
npx nativeproof onboard /path/to/MyApp.app
npx nativeproof onboard /path/to/app-debug.apk

npx nativeproof --ios
npx nativeproof --android
npx nativeproof --project ios
npx nativeproof --spec tests/login.spec.ts
npx nativeproof --no-appium
```

Bin aliases:

```bash
npx nativeproof-init --ios
npx nativeproof-init --android
npx nativeproof-onboard /path/to/app
```

## CI

NativeProof runs through Appium, so CI needs a device target.

- Android CI: install Node, install app dependencies, boot an emulator, run `npx nativeproof --android`.
- iOS CI: use a macOS runner, install Node, boot a simulator, run `npx nativeproof --ios`.
- Device farms work too: put the Appium host/port/path in `nativeproof.config.ts`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `no nativeproof.config.ts found` | Run from the E2E project root, or run `npx nativeproof init --ios` / `npx nativeproof init --android`. |
| Appium is not reachable | Boot the emulator/simulator, or remove `--no-appium` so NativeProof can start local Appium. |
| Missing Appium driver | Let NativeProof auto-install, or run `npx appium driver install xcuitest` / `uiautomator2`. |
| iOS repo onboarding cannot find a scheme | Share the app scheme in Xcode, or onboard a built simulator `.app`. |
| iOS build exits `65` | If a simulator `.app` was produced, NativeProof stages it and continues. If not, fix the Xcode error and retry. |
| Android app cannot reach mock server | Use `10.0.2.2` from the Android emulator, not `127.0.0.1`. |
| Locator times out | The error lists the closest on-screen candidates ("did you mean …?") — the usual cause is an exact-string mismatch with the real label. Prefer semantic locators over guessing implementation selectors. |

## Evidence

On any failed test, NativeProof writes a screenshot + redacted page source under
`.e2e-artifacts` (configurable via `artifacts.dir`), named after the failing spec. To capture
extra checkpoints inside a spec:

```ts
import { captureState } from "nativeproof";

await captureState("after-login"); // screenshot + page-source pair in the artifact dir
```

## Current Limits

- iOS source onboarding supports standard Xcode projects/workspaces with shared schemes.
- Android source onboarding does not build Gradle projects yet; onboard the built `.apk`.
- Real-device iOS needs normal signing/provisioning for the app and WebDriverAgent.

## License

MIT
