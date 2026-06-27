# NativeProof North Star

NativeProof should be Playwright-feeling native E2E, not a new test framework.

The core promise is:

```sh
npx nativeproof init --ios
# or
npx nativeproof init --android
```

After that, the user should have a minimal runnable native E2E project:

- `nativeproof.config.ts`
- one readable example spec
- npm scripts
- sensible Appium/WebdriverIO/device/app/artifact defaults
- no runner archaeology

Tests should look like tests, not framework plumbing:

```ts
it("should be able to log in", async () => {
  await native.navigate("/login");
  await native.tap("Log in");

  await expect(native.getByText("Welcome back")).toBeVisible();
});
```

## Product Rules

1. All control lives in `nativeproof.config.ts`.

   Device selection, app paths, platform, capabilities, backend URL, artifacts, retries, timeouts,
   spec globs, and WebdriverIO escape hatches belong in the config.

2. Specs keep meaningful setup visible.

   NativeProof may remove boring bootstrapping, but it must not hide the story setup a reader needs
   to understand the test's starting state.

3. Never abstract interaction or assertion behind domain helpers.

   Avoid:

   ```ts
   await loginAsTestUser();
   expectLoggedIn();
   ```

   Prefer:

   ```ts
   await native.tap("Log in");
   await expect(native.getByText("Welcome back")).toBeVisible();
   ```

4. Use runner-native language.

   Keep `describe`, `describe.skip`, `it`, `it.skip`, and `expect`. NativeProof should not recreate
   Jest, Mocha, or Playwright Test. It should make native app control feel first-class inside those
   runner words.

   Do not add or promote public `test.*` facades. If a fixture-heavy compatibility API remains, keep
   it secondary and do not use it in generated projects or first-read documentation.

5. Fixtures are allowed only when they expose intent.

   Good:

   ```ts
   beforeEach(async () => {
     await native.launch({ route: "/login", reset: true });
   });
   ```

   Risky:

   ```ts
   useLoggedOutUserFixture();
   ```

## Current Direction

Make `nativeproof init --ios|--android` produce a minimal, readable, working project where all
device/app control is in `nativeproof.config.ts`, and the generated test shows direct
`native.*` interactions plus plain `expect`.

The readability target is not more NativeProof DSL. It is less NativeProof visible in the test.
