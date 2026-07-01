# Onboard Next Steps Proof

This proof covers the CLI/docs handoff change for `nativeproof onboard`.

The previous onboard success message told a fresh-project user to run the suite immediately. That was too strong for real apps: onboarding can point NativeProof at the app artifact, but the generated `tests/example.spec.ts` and `native.navigate(...)` route are still app-specific.

Screenshots are not meaningful for this PR because it changes CLI text and README command comments, not rendered app or device behaviour. The proof is the fresh generated-project transcript below.

## Fresh Project

The proof was run from a temp project outside this repository with a locally packed NativeProof tarball:

```sh
npm pack --pack-destination "$PACK_DIR"
npm init -y
npm install -D "$TARBALL"
npx nativeproof --version
npx nativeproof init --android
touch app-debug.apk
npx nativeproof onboard ./app-debug.apk
node --import tsx -e "await import('./nativeproof.config.ts'); console.log('config import ok')"
```

Key output:

```text
0.10.14
nativeproof: created nativeproof.config.ts
nativeproof: created tests/example.spec.ts
nativeproof: updated package.json
nativeproof: updated nativeproof.config.ts
nativeproof: package.json already exists — skipped
nativeproof: onboarded android app at ./app-debug.apk

Next: make tests/example.spec.ts and native.navigate(...) match your app, then run `npm run test:e2e` or `nativeproof --android`.
config import ok
verified corrected onboard next-step text
```

Artifacts:

- `00-npm-pack.log`
- `01-npm-init.log`
- `02-npm-install-local-tarball.log`
- `03-nativeproof-version.log`
- `04-nativeproof-init-android.log`
- `05-nativeproof-onboard-android.log`
- `06-generated-config-import.log`
- `07-next-step-grep.log`
- `generated-nativeproof.config.ts`
- `generated-example.spec.ts`
