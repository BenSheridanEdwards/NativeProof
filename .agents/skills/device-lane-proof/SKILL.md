---
name: device-lane-proof
description: Use when a change touches device or Appium behaviour (driver, gestures, locators, ios/adb helpers, runner) and the Definition of Done requires running the focused device lane, or when a PR needs on-device screenshot proof. Explains how to run a real spec on a booted simulator/emulator and where the evidence lands.
---

# Device Lane Proof

Unit tests fake the driver; they cannot prove that a gesture lands on a real
screen. The Definition of Done requires the focused device lane for
device/Appium behaviour changes — a real spec, on a real booted target,
exercising exactly the changed behaviour. "Focused" means one small spec that
hits the change, not the whole suite.

## Required Pattern

1. Confirm a booted target exists:

   ```sh
   xcrun simctl list devices booted   # iOS: expect at least one Booted device
   adb devices                        # Android: expect a device/emulator line
   ```

   No booted target and no way to boot one? Stop and write the exact reason in
   the PR ("Full device coverage not run: ..."). Do not fake the lane.

2. Get a runnable project pointed at a real app artifact. Either reuse an
   existing local E2E project, or scaffold one from the packed tarball
   (see `.agents/skills/verify-generated-project/SKILL.md`) and run
   `nativeproof onboard <path-to-.app|.apk|ios-repo>`.

3. Write or adapt one focused spec that exercises the changed behaviour using
   direct `native.*` calls and plain `expect`, then run it:

   ```sh
   npx nativeproof --ios     # or --android
   ```

4. Collect evidence. NativeProof writes a screenshot + redacted page-source
   pair for every meaningful step into `.e2e-artifacts/` (or the configured
   `artifacts.dir`). Pick the screenshots that show the changed behaviour.

5. Commit the chosen screenshots under `docs/proof/<short-scope>/` on the PR
   branch and embed them inline per
   `.agents/skills/pr-inline-screenshot-proof/SKILL.md`. Include the exact
   command run and its pass/fail output in the PR proof section.

## Hard Failures

- Proof screenshots taken from a fake/mock driver run — the lane exists
  precisely because mocks cannot prove device behaviour.
- Running the lane against an app or spec that never exercises the changed
  code path.
- Silently skipping the lane. Skipping is allowed; hiding the skip is not —
  the PR must state why it was not run.

## Verification

The spec run exits 0 (or the failure is the point and is explained),
`.e2e-artifacts/` contains the step screenshots, and the PR body embeds the
relevant ones inline with `![alt](...png?raw=1)`.
