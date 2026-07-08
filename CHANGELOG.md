# Changelog

All notable changes to NativeProof are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## 0.13.1

**Fixed**

- iOS project onboarding now stages the freshly built simulator app instead of allowing an older
  source-tree `.app` to win when both are present.
- `expect(locator)` now honors the locator's configured wait options, while still letting
  call-site matcher options override them.

## 0.13.0

Visible-state locator filtering.

**Added**

- `getByRole(role, { visible: true | false })` (and `by.role`) keeps only elements the
  toolkit reports on screen — iOS `visible="true"`, Android `displayed="true"`. Native
  trees carry offscreen or shadow duplicates of the same role (a hidden SwiftUI text field
  behind the focused one returns first in document order, so `fill()` types nowhere);
  `{ visible: true }` picks the live instance. Composes with `name`/`checked`/`disabled`
  and closes the gap that forced consumer suites onto raw
  `-ios predicate string:... AND visible == 1` selectors.

## 0.12.0

Scrolling, selector discovery, and a hardened locator core.

**Added**

- `Locator.scrollIntoView({ direction?, maxSwipes? })` swipes until the element appears —
  Playwright's scrollIntoViewIfNeeded for native, computing the swipe vector from the page
  source's own bounds. Backed by an optional `Driver.swipe` seam. Device-proven on Android 15
  and iOS 26.5 (`docs/proof/scroll-into-view/`).
- `nativeproof inspect` prints the candidate `native.*` locators for the configured app's
  current screen — semantic roles with names first, then visible text, then test ids — ending
  the read-the-XML-and-guess authoring loop (`docs/proof/inspect/`).
- `expect(locator).toHaveValue(value)` and `Locator.inputValue()` assert an input's own content
  (no label/placeholder fallback).
- `getByRole(role, { checked?, disabled? })` selects controls by state.
- `fill()`/`clear()` warn when the matched node is not a text input — the silent-no-op
  observed on real devices when a locator matches a label instead of the field.

**Fixed**

- Attribute matching is anchored to whole names: `long-clickable` no longer passes as
  `clickable` (wrong `clickableAncestor` tap targets, lying `toBeEnabled`/`toBeDisabled`) and
  iOS `placeholderValue` is no longer read as `value` (placeholders matched as visible text).
- Exact-string selectors match labels however the source escaped them (`&apos;`, `&#39;`, or a
  literal apostrophe) — `getByText("I'll speak")` previously could never match.
- Caller-supplied `g`-flagged RegExps no longer carry state across wait polls, which made
  negated `toShow`/`toHaveText` assertions falsely pass.
- `near()` anchors, clickable ancestors, and control-state lookups resolve from a single
  source snapshot — no more cross-frame mispairing under animation (and one source read per
  poll instead of three).
- `startMockServer` rejects with an actionable error on a busy port instead of crashing the
  worker process.
- Onboarding config rewrites survive comments containing apostrophes or braces.
- `--ios` with no iOS project errors listing the available projects instead of silently
  running the first project; the CLI preflight honors the same `PLATFORM` /
  `NATIVEPROOF_PROJECT` env vars the runner reads.

**Changed**

- The README now documents the full locator, interaction, assertion, and mocking surface,
  including `mock.route()` + traffic assertions and the did-you-mean failure hints.

## 0.11.0

Atomic text entry and self-explaining failures.

**Added**

- `Locator.fill(text)` and `Locator.clear()` now prefer an atomic element path via the new optional
  `Driver.setValueOnNode(node, text)`: the wdio driver resolves the matched source node to an
  exact-XPath element and calls `setValue`, which clears and types in one native call on both
  UiAutomator2 and XCUITest. Falls back to the focus-tap + clear + type path when the node cannot
  be resolved or a custom driver does not implement the hook. Device-proven on Android 15 and
  iOS 26.5 (`docs/proof/atomic-fill/`).
- Locator not-found errors (waits, taps, and positive `expect` failures) now end with a
  "did you mean" list of the closest on-screen candidate values, ranked by edit distance, read
  from the attributes the selector targets — so an exact-string mismatch is visible in the failure
  itself instead of requiring a page-source grep.
- `exactNodeXPath(node, platform)` builds an exact element XPath for a matched source node on both
  platforms (previously iOS-only via `iosExactNodeXPath`).

**Changed**

- Onboarding failures are actionable: re-onboarding refuses to shadow an `"appium:app"` it cannot
  rewrite (previously it silently inserted a losing duplicate key and claimed success), ambiguous
  Xcode scheme selection warns which scheme was picked and which were skipped, a missing Android
  `.apk` explains how to build one, and iOS build / Appium driver-install failures point at the
  concrete evidence and escape hatches.

## 0.10.14

iOS project onboarding that builds and stages a simulator app.

**Added**

- `Locator.press({ duration })` can press-and-release a matched native control without spelling out
  WebDriver pointer actions in consumer specs.
- `nativeproof onboard <path-to-ios-project>` can now detect a top-level `.xcodeproj` or
  `.xcworkspace`, choose an app-like shared scheme, run a Debug `iphonesimulator` build, and stage
  the newest produced `.app` at `./build/ios/<AppName>.app`.
- iOS onboarding uses NativeProof-owned build cache paths under `.nativeproof/ios` so fresh E2E
  projects do not need hand-written Xcode output paths before they can write a spec.

**Changed**

- If Xcode exits non-zero after producing a simulator `.app`, onboarding now warns and continues
  with the staged app. This matches real projects where a late script phase can fail after the
  runnable app artifact already exists.
- NativeProof runs the onboarding `xcodebuild` step with `-quiet` so first-run package/build logs do
  not swamp the setup experience.

## 0.10.13

NativeProof-owned onboarding for built app artifacts.

**Added**

- `nativeproof-onboard <path>` is now a package bin alias for onboarding a built Android `.apk` or
  iOS simulator `.app`.
- `nativeproof onboard <path>` provides the same flow through the main CLI. It creates a minimal
  NativeProof project when no config exists, or updates the matching project in
  `nativeproof.config.ts` when one already exists.
- Onboarding can discover built `.apk` / `.app` artifacts inside native app repo directories and
  fails clearly when a repo has no built artifact instead of guessing app-owned build commands.
- Generated configs opt into `appium.autoInstallDrivers` and
  `appium.autoSelectBootedSimulator`, so the first local run can install the missing Appium
  platform driver and use the currently booted iOS simulator without pinning a fake device model.

**Fixed**

- NativeProof now depends on `@wdio/spec-reporter`, matching the generated WebdriverIO config so
  fresh installs do not fail with a missing `spec` reporter.
- iOS `Locator.tap()` now clicks native accessible controls directly before falling back to
  coordinate taps. Real XCUITest sessions were accepting coordinate taps without activating a
  standard UIKit button, which broke the generated sign-in spec against a real app.

## 0.10.12

iOS focused text input through Appium element send keys.

**Fixed**

- `Locator.fill()` now types into the focused iOS element with Appium `elementSendKeys` instead of
  WebdriverIO key actions. This avoids XCUITest/WDA key-action failures such as
  `Key Down action '1' must have a closing Key Up successor` while preserving Android's existing
  keyboard-input path.

## 0.10.11

Tolerant named role matching for native text fields.

**Fixed**

- `getByRole("textfield", { name })` now tolerates tiny native geometry rounding drift when a
  visible iOS placeholder/label is exposed as a sibling just inside the field. This keeps readable
  specs on direct named role locators instead of falling back to `.first()` for common XCUITest
  text-field source shapes.

## 0.10.10

Named role locators for Compose-labelled controls.

**Fixed**

- `getByRole(role, { name })` now matches common Android Compose control shapes where the visible
  label is exposed on a child/sibling `text` or `content-desc` node inside the role node's bounds.
  This lets readable specs use direct locators such as `getByRole("button", { name: "Search" })`
  and `getByRole("textfield", { name: /email/i })` instead of falling back to text taps or
  `.near(...)` for those controls.
- Named role matching still rejects same-named text outside the control bounds, so an unrelated label
  cannot satisfy a role locator.

## 0.10.9

Playwright-style text replacement for native fields.

**Added**

- `Locator.clear()` focuses a text field and clears its current value through the active native
  element.

**Changed**

- `Locator.fill(text)` now replaces existing field text: focus, clear, then type. This matches the
  Playwright mental model and lets app specs avoid raw WebdriverIO field-clearing helpers.
- `Locator.isEnabled()` / `isDisabled()` and `expect(locator).toBeEnabled()` / `toBeDisabled()` now
  read the smallest clickable ancestor when the visible label is a non-clickable child. This lets
  Compose/SwiftUI-style button labels assert the real control state without XPath parent selectors.

## 0.10.8

One-command init alias for setup.

**Added**

- `nativeproof-init` is now a package bin alias for the init flow, so
  `npx nativeproof-init --ios` and `npx nativeproof-init --android` scaffold the same minimal
  config-owned project as `npx nativeproof init --ios|--android`.

## 0.10.7

iOS checkbox semantics for custom controls.

**Fixed**

- `getByRole("checkbox")` now recognises iOS checkbox-like buttons whose accessible name identifies
  them as checkboxes. This covers SwiftUI/custom controls that XCUITest exposes as
  `XCUIElementTypeButton` rather than `XCUIElementTypeSwitch`.
- `Locator.isChecked()` / `expect(locator).toBeChecked()` now understand iOS checked state exposed
  through `value="1"`, selected traits, or checked/unchecked accessibility labels, in addition to
  Android `checked="true"`.

## 0.10.6

Semantic role locators for readable native specs.

**Fixed**

- `getByRole(role, { name })` / `by.role(role, { name })` now match the native element role and
  accessible name together. Previously the named form matched only the accessibility label, which
  meant a same-named non-control could satisfy a role locator. Specs can now trust readable patterns
  such as `native.getByRole("checkbox", { name: /Accept Agreement/ })`.

**Changed**

- The north-star docs now explicitly prefer Jest/React Testing Library/Playwright-style semantic
  locators and reject selector-name constants as a readability abstraction.

## 0.10.5

Native-first setup and config-owned control, so generated projects read like runner-native tests
instead of framework plumbing.

**Added**

- `createNative(...)` — a direct native app control surface for runner-native specs that import
  `native` and `expect` from `nativeproof.config.ts`.
- Agent-facing north-star guidance in `.agents/NORTH_STAR_GOAL.md`, `CLAUDE.md`, `AGENT.md`, and
  `AGENTS.md`.

**Changed**

- `nativeproof init --ios|--android` now scaffolds a minimal single-platform project with
  `nativeproof.config.ts`, one readable `describe`/`it` spec, and a plain `test:e2e` npm script.
- `nativeproof.config.ts` is the single control plane for app paths, device capabilities, Appium
  host/port/path, artifacts, spec globs, timeouts, and WebdriverIO tuning.
- The README and generated examples now default to direct `native.*` interactions and plain
  `expect(...)` assertions; the fixture harness remains documented as legacy/advanced compatibility.

**Removed**

- Public `test.*` mini-runner exports from the primary API.
- Raw `wdio.conf.ts` discovery, `--config`, and Appium endpoint CLI flags from the user-facing CLI
  path.
- Generated `NATIVEPROOF_*` app/device env overrides and the artifact env escape hatch.

## 0.10.4

Per-project spec sets and WebdriverIO tuning pass-through, for suites that run a different set of
specs per platform and need longer timeouts on slow devices.

**Added**

- `DeviceProject.specs` — per-project spec globs that override the top-level `testDir`/`testMatch`,
  for suites where platforms run different specs (e.g. a shared set plus a platform-specific set:
  `["e2e/shared/**\/*.spec.ts", "e2e/android/**\/*.spec.ts"]`). A `--spec` CLI override still wins.
  Precedence: `--spec` (comma-separated) > `project.specs` > `testDir`/`testMatch`.
- WebdriverIO tuning pass-throughs on `RunnerConfig`: `connectionRetryTimeout`,
  `connectionRetryCount`, `waitforTimeout`, `bail`, and `logLevel`. Each is forwarded to the
  synthesised WebdriverIO config only when set, so WebdriverIO's own defaults apply otherwise —
  slow software-GPU emulators in particular often need longer connection/wait timeouts. `bail: 0`
  is meaningful (never bail) and is still forwarded.

## 0.10.3

Out-of-the-box setup: scaffolding, minimal config, a route-optional mock contract, and typed
contexts across the `createHarness` export boundary.

**Added**

- `nativeproof init` scaffolds a starter `nativeproof.config.ts` (app + harness + android/ios
  projects) and a sample spec, so a new project is runnable in one command. Idempotent — it
  never overwrites an existing file.
- `defineApp` now accepts any mock that exposes `frames()` + `stop()` (the new `SessionMock`);
  `route()` is no longer required, since a session never routes (only a spec does). An app whose
  mock only observes traffic can use `defineApp` / `createHarness` / `nativeproof.config` directly.
- `buildWdioConfig` fills in `platformName` and `appium:automationName` per platform (Android →
  UiAutomator2, iOS → XCUITest), so a project needs only `name` + `platform`. A project's own
  capabilities still win, and `DeviceProject.capabilities` is now optional.

**Fixed**

- `export const { test } = createHarness(app)` consumed from a spec in another file now keeps a
  fully-typed fixture context. The harness/app/config are parameterised by the *resolved* context
  rather than the screens type `S` (which TS widened to its constraint — screens → `unknown` — when
  computing the exported type), so behaviours get typed `mock` and screens across the import
  boundary. `App<S, M>` is now `App<Ctx>`; `NativeProofConfig` / `defineConfig` follow.

## 0.10.2

Generic mock typing and built-in evidence-on-failure.

**Added**

- `defineApp` (and `createHarness` / `defineConfig`) are now generic over the mock type. An app
  whose mock extends the base contract gets that concrete type through screens, login/join,
  teardown, `onFailure` and the session context — no casts. Existing single-type-arg uses are
  unchanged (the mock type defaults to `MockBackend`).
- The synthesised runner config captures evidence on a failed behaviour out of the box — a
  screenshot + redacted page source named after the spec — so apps need no hand-written
  `afterTest`. Best-effort: a capture error never masks the real failure.

## 0.10.1

Cross-platform locator resolution fixes.

**Fixed**

- `by.text` / `getByText` with a `RegExp` now matches a label exposed via `content-desc`
  (e.g. Compose). The RegExp path previously tested only the first attribute in the
  `text`/`content-desc` alternation, so a label was missed when an empty `text=""` preceded it.
- Locators now resolve iOS element geometry (XCUITest `x`/`y`/`width`/`height`), so `tap()`,
  `bounds()` and `near()` work on iOS — not just Android `bounds="[x1,y1][x2,y2]"`.

## 0.10.0

Element enabled-state assertions.

**Added**

- **`Locator.isEnabled()` / `isDisabled()` and `expect(locator).toBeEnabled()` / `toBeDisabled()`** —
  read the matched element's `enabled` attribute (present and not `enabled="false"` is enabled, matching
  Playwright's default-enabled semantics). Auto-waiting, `.not` inverts. For asserting a button/control
  flips between enabled and disabled as a form validates.

## 0.9.0

Regex frame matching — `expect(mock)` matches traffic by pattern.

**Added**

- **`toHaveSent` / `toHaveReceived` (and `FrameMatch`) accept a `RegExp`** for `path`, `type`, and any
  payload field — `expect(mock).toHaveSent({ path: /\/users/, type: "request" })` matches a
  query-suffixed or otherwise variable path, mirroring regex selectors on the locator side. A string
  stays an exact match (deep equality for payload objects); a RegExp tests the actual string value.

## 0.8.0

Relative locators — `Locator.near` scopes to the match nearest an anchor.

**Added**

- **`Locator.near(anchor, { maxDistance? })`** — orders this locator's matches by bounds-centre
  distance to the `anchor` locator's match, nearest first, so a control is addressed by the element
  beside it: `getByRole("checkbox").near(getByText("Wi-Fi"))` is the checkbox in the Wi-Fi row.
  `maxDistance` (px) drops farther matches, so an absent control resolves to nothing. Composes with
  `.nth()` / `.check()` / `expect(locator).toBeChecked()`. Together with role selectors this retires
  source-bounds geometry for "the control next to this label".

## 0.7.0

Role selectors — `getByRole` matches by element role, not just name.

**Added**

- **`getByRole(role)` / `by.role(role)` match by element class/type** when no `name` is given —
  `checkbox`, `switch`, `button`, `textfield`, `image`. Maps to the Android widget `class` / iOS
  XCUITest `type` as a substring, so `SwitchCompat`, `MaterialButton`, and Compose's
  `android.widget.CheckBox` all resolve. Combine with `.nth()` / `expect(locator).toBeChecked()`.
  `getByRole(role, { name })` is unchanged (matches the accessibility label); an unknown role throws
  with the supported list. New `nodesForRole` source helper.

## 0.6.0

Playwright-parity additions to locators, assertions, fixtures, and evidence.

**Added**

- **Checkbox/switch state** — `Locator.isChecked()`, `Locator.check()` / `uncheck()` (tap to the
  desired state, a no-op if already there), and auto-waiting `expect(locator).toBeChecked()` (+ `.not`),
  reading `checked="true"` on the matched node.
- **Multi-match locators** — `Locator.nth(i)` / `first()` / `last()` (negative `i` counts from the end),
  `Locator.count()`, and auto-waiting `expect(locator).toHaveCount(n)`. An unindexed locator still
  resolves to the first match. New `nodesForAttribute` source helper backs it.
- **Scenario `beforeEach` / `afterEach`** — `test.beforeEach(fn)` / `test.afterEach(fn)` (and the
  `describeScenario` registrar's `.beforeEach` / `.afterEach`) register per-behaviour hooks that
  receive the provisioned fixture context — a repeatable reset between behaviours without leaving the
  harness. `BddHooks` gained optional `beforeEach` / `afterEach` (present on Mocha and node:test).
- **`onFailure` evidence hook** — `ScenarioFixture.onFailure` and `defineApp({ onFailure })` run when a
  behaviour throws, before the failure propagates, so on-failure evidence (e.g. `captureState(...)`)
  lives in one place instead of every behaviour. The hook receives the context + `{ title, error }`;
  its own errors are swallowed (logged) so they never mask the real failure.
- **`by.*` and every `page().getBy*` accept a `RegExp`** as well as a string —
  `getByText(/Save( draft)?/)`, `getByLabel(/^Remove /)`, `getByRole("checkbox", { name: /terms/i })`.
  A string matches the element's value exactly; a RegExp is tested against the element's **decoded**
  value, so a human pattern matches the entity-escaped source and tolerant labels
  (`/complete(d)? phrases/`) no longer need source-scraping. Matching, `bounds`, `textContent`,
  `tap`/`fill`, and `expect(locator)` all honour it. New `nodeForAttribute` / `attributeMatches`
  source helpers back it (`boundsForAttribute` now takes `string | RegExp`).

## 0.5.0

Two additive, backward-compatible seams so an app can drive more of its lifecycle and
traffic assertions through the framework instead of around it.

**Added**

- **`expect(...)` accepts any frame source, not just a full `MockBackend`** — a new
  `FrameLog` interface (`{ frames() }`, which `MockBackend` extends) is all the traffic
  matchers need. An app whose mock predates `MockBackend` can expose a frames-only adapter
  over its existing request/socket log and get auto-waiting `expect(traffic).toHaveSent({
  path, type, ...payload })` / `.toHaveReceived(...)` — no `route`/`stop` to implement.
- **`defineApp({ teardown })`** — an optional app-level teardown hook, run on session
  teardown BEFORE the mock stops and before the runner deletes the device session (e.g.
  force-stop the app so its background sockets are gone before `deleteSession`). The mock
  is still stopped even if the hook throws.

## 0.4.0

Dead-code removal. The dropped exports were undocumented and unused by the framework, but
since they were technically part of the published surface this is a minor bump.

**Removed**

- **`src/text.ts`** — a legacy WebdriverIO-`$`-based selector/text layer (`exactText`,
  `tapVisibleText`, `typeInto`, `waitForAnyVisibleText`, …) superseded by the `Driver` / `Locator` /
  `page` stack. Use `page(driver).getByText(...)` / `Locator.fill(...)` instead.
- **`src/screen.ts`** — the unused `Screen` base class (nothing extended it).
- **`src/wait.ts`** — `waitAndClick` / `waitForAnyDisplayed`, only ever used by `Screen`.
- **`readLog`** (from `log.ts`) and **`waitForFrame`** (from `mock.ts`) — unused exports. The
  documented mock-traffic API (`expect(mock).toHaveSent/toHaveReceived`) is unaffected.

## 0.3.1

Correctness and robustness fixes; no API changes.

**Fixed**

- **`expect(mock)` now matches object/array payload fields by deep equality** — `matchesFrame`
  used reference equality, so `toHaveSent({ data: { id: 1 } })` / `{ tags: ["a"] }` could never
  match and surfaced only as a misleading timeout. Now uses `isDeepStrictEqual`.
- **`textContent()` prefers the first non-empty label attribute** — an iOS node with
  `value="" label="Submit"` (or an Android Compose node with `text="" content-desc="…"`) read as
  `""`; it now returns the populated value, in the same precedence `attributeFor` uses.
- **Bounds parsing no longer assumes attribute order** — `boundsForAttribute` /
  `smallestClickableAncestorBounds` match the element tag first, then extract `bounds`, so a source
  that emits `bounds` before the selector attribute still resolves.
- **`parseBounds` accepts negative coordinates** — off-screen / RTL-shifted nodes (`[-5,0]…`) now
  parse instead of becoming untappable.
- **Historical `--appium-port` flag validation** — in 0.3.1, a non-numeric / out-of-range value
  threw a clear error instead of producing an opaque `http://host:NaN/…` connection failure.
  Current CLI versions no longer expose this flag.
- **`toContain` throws a usage error** on a non-string/array actual instead of silently failing.
- **Page-source capture failures are logged** — `wdioDriver().source()` and `captureState` warn on a
  `getPageSource` error before degrading to empty, so a dead session isn't mistaken for an empty screen.

**Internal**

- Deduplicated `escapeRegExp` (now shared from `source.ts`).

## 0.3.0

Maintenance release — version bump only; no functional changes since 0.2.0.

## 0.2.0

Locator interaction, generic assertions, and Compose/SwiftUI robustness — plus the docs for each.

**Added**

- **`Locator.fill(text, opts?)`** — native text entry, the analogue of Playwright's `locator.fill()`:
  it focuses the field (a `tap()`) and types through the device keyboard. New optional `Driver.typeText?`
  hook (`wdioDriver()` implements it with platform-appropriate Appium text input); `fill()` throws a
  clear error on drivers without text input. It does **not** clear existing content first. (#5)
- **Generic `expect(value)` matchers** — `toBe` / `toEqual` / `toContain` / `toBeTruthy` / `toBeFalsy` /
  `toBeDefined` / `toBeNull` (+ `.not`). These are **synchronous** (unlike the auto-waiting locator/mock
  matchers), so non-UI checks (counts, ids, parsed payloads) need no second assertion library. (#4)
- **`tap({ clickableAncestor: true })`** — taps the smallest `clickable="true"` ancestor that contains
  the matched node, for Compose/SwiftUI labels that sit on a non-clickable child of the real touch target. (#3)

**Changed**

- **`getByText` / `by.text` is now forgiving** — it matches `text` *or* `content-desc` on Android and
  `label` *or* `value` on iOS, so a visible label is found wherever the toolkit exposes it. This broadens
  matching for existing `by.text` selectors; use `getByLabel` / `by.desc` when you want the accessibility
  description specifically. (#3)

**Fixed**

- **XML entity handling in locators** — selectors built from human-readable strings
  (`by.text("Terms & Conditions")`) now match the entity-escaped page source, and `textContent()` decodes
  entities back to plain text. (#2)
- **`./package.json` is now exported** — resolvable through the package `exports` map for tooling and
  bundlers that read it. (#1)

**Docs**

- "Bring your own backend" — documents the `MockBackend` adapter pattern for apps with an existing mock
  server, and clarifies which symbols import from `nativeproof` vs your `nativeproof.config`. (#6)
- Every feature above is documented in the README (Locators, Assertions, Features, API reference).

## 0.1.1

Documentation pass: refreshed the README examples, expanded the iOS setup guide, and
tidied the inline API docs. No API or behaviour changes.

## 0.1.0

Initial release — a Native Mobile E2E test framework inspired by Playwright, on
Appium/WebdriverIO.

- **Fixtures** — `defineApp` (the single app seam) and `createHarness(app)` for a typed,
  module-global `test` / `test.describe` with the session context injected per behaviour.
- **Config** — `nativeproof.config.ts` + `defineConfig` (the `playwright.config.ts` analogue);
  the `nativeproof` CLI auto-discovers it and synthesises the WebdriverIO run.
- **Locators** — `by.text/testId/label/desc/id` and `page(driver).getByText/getByTestId/
  getByLabel/getById/getByRole`, mapped to the right native attribute per platform.
- **Assertions** — auto-waiting `expect(locator).toBeVisible/toShow/toHaveText` and
  `expect(mock).toHaveSent/toHaveReceived`, each with `.not`.
- **Network mocking** — a first-party HTTP + WebSocket mock server with Playwright-style
  `route().fulfill/reject/abort` and traffic assertions; no per-app adapter.
- **Device commands** — Android `adb` (`adbForceStop`, `resetAppAndBrowserState`, `adbTap`, …)
  and iOS `simctl` (`iosTerminate/Launch/Install/Uninstall/Boot/Shutdown`, `resetAppState`).
- **CLI** — `nativeproof` runs the suite (auto-starts Appium), for Android and iOS.
