# iOS Checkbox Button Role Proof

Date: 2026-06-29

This proof was run from a fresh folder outside this repository and the Wordly
test-suite repository:

- Fresh project: `/tmp/nativeproof-wordly-checkbox-proof-pr-XjwaX6zE/ios-project`
- NativeProof package: locally packed `nativeproof-0.10.14.tgz` from this branch
- Wordly iOS app: `/Users/agents/Projects/nativeproof-wordly-ios-fresh-proof/ios/Wordly.app`
- Wordly bundle: `ai.wordly.ios.dev`
- Simulator: booted iPhone 16, iOS 26.5

## NativeProof Change

The real Wordly iOS EULA control is a small `XCUIElementTypeButton`, not an
accessibility-role checkbox. Before this branch, a readable spec could not use
`getByRole("checkbox")` for that control and fallback attempts risked clicking
the adjacent "Terms of Service" link.

This branch lets iOS `getByRole("checkbox")` include small square button-shaped
controls with checkbox-like selected state. The fresh Wordly proof below uses:

```ts
const AgreementText = native.getByText(/I have read and agreed/i);
const AcceptAgreementCheckbox = native.getByRole("checkbox").near(AgreementText, { maxDistance: 140 });
const AcceptButton = native.getByRole("button", { name: "Accept" });

await expect(AcceptButton).toBeDisabled();
await AcceptAgreementCheckbox.check();
await expect(AcceptAgreementCheckbox).toBeChecked();
await expect(AcceptButton).toBeEnabled();
await AcceptButton.tap();
```

## Fresh Install And Onboard

Command:

```sh
npm pack /Users/agents/Projects/NativeProof-ios-checkbox-button-role --pack-destination /tmp/nativeproof-wordly-checkbox-proof-pr-XjwaX6zE
```

Relevant output:

```text
npm notice name: nativeproof
npm notice version: 0.10.14
npm notice filename: nativeproof-0.10.14.tgz
npm notice package size: 58.3 kB
npm notice unpacked size: 196.1 kB
npm notice shasum: ed46f54effeb43e95f9a61fc58381179be77b8b5
npm notice total files: 46
nativeproof-0.10.14.tgz
```

Command:

```sh
npm init -y
```

Output:

```text
Wrote to /private/tmp/nativeproof-wordly-checkbox-proof-pr-XjwaX6zE/ios-project/package.json:

{
  "name": "ios-project",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs"
}
```

Command:

```sh
npm install -D /tmp/nativeproof-wordly-checkbox-proof-pr-XjwaX6zE/nativeproof-0.10.14.tgz
```

Output:

```text
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster implementation
npm warn deprecated glob@8.1.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 730 packages, and audited 731 packages in 22s

163 packages are looking for funding
  run `npm fund` for details

4 vulnerabilities (3 moderate, 1 high)

Some issues need review, and may require choosing
a different dependency.

Run `npm audit` for details.
```

Command:

```sh
npx nativeproof --version
```

Output:

```text
0.10.14
```

Command:

```sh
npx nativeproof init --ios
```

Output:

```text
nativeproof: created nativeproof.config.ts
nativeproof: created tests/example.spec.ts
nativeproof: updated package.json

Next: set the app path + native.navigate(...) in nativeproof.config.ts, then run `npm run test:e2e`.
```

Command:

```sh
npx nativeproof onboard /Users/agents/Projects/nativeproof-wordly-ios-fresh-proof/ios/Wordly.app
```

Output:

```text
nativeproof: updated nativeproof.config.ts
nativeproof: package.json already exists — skipped
nativeproof: onboarded ios app at /Users/agents/Projects/nativeproof-wordly-ios-fresh-proof/ios/Wordly.app

Next: run `npm run test:e2e` or `nativeproof --ios`.
```

## Device Run

Command:

```sh
xcrun simctl uninstall booted ai.wordly.ios.dev
```

Output: no output, exit status 0.

Command:

```sh
npx nativeproof --ios --spec tests/wordly-terms.spec.ts
```

Relevant output:

```text
[Wordly.app iOS #0-0] Wordly iOS terms onboarding
[Wordly.app iOS #0-0]    ✓ should let a new user accept the terms
[Wordly.app iOS #0-0]
[Wordly.app iOS #0-0] 1 passing (9.2s)

Spec Files:	 1 passed, 1 total (100% completed) in 00:00:15
```

The Appium source captured during the same run showed the control changing to
selected state after `check()`:

```xml
<XCUIElementTypeButton type="XCUIElementTypeButton" value="1" name="checkmark" label="Selected" enabled="true" visible="false" accessible="false" x="44" y="1051" width="22" height="23" index="2" traits="Selected, Button"/>
```

Screenshot after accepting the EULA:

![Fresh Wordly iOS terms accepted](fresh-ios-terms-accepted-home.png)

## Verification

NativeProof local gates on this branch:

```text
npm run check
npm test
```

Both passed after this proof bundle was added.
