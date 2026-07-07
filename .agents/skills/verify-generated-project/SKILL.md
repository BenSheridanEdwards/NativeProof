---
name: verify-generated-project
description: Use when a change touches the CLI, init/onboard scaffolding, or the generated project surface (src/cli.ts, templates, runner-config) and the Definition of Done requires proof that the generated project still works. Produces that proof from the packed tarball, not from the repo checkout.
---

# Verify Generated Project

The Definition of Done says: for generated project or CLI changes, prove the
generated project still builds. The repo test suite covers most of this —
`test/package-smoke.test.ts` packs the tarball and exercises init/onboard —
so start with `npm test`. Run the manual lane below when the change affects
what a fresh consumer sees (template contents, onboarding output, CLI text)
and you need proof beyond the smoke test's assertions.

Proof must come from the packed tarball. The repo checkout has dev
dependencies and dist quirks a consumer never sees; a scaffold that works from
`src/` can still be broken from the published package.

## Required Pattern

All verified end-to-end; run from a temp directory, not inside the repo.

```sh
# 1. Pack the current build (prepare runs the TypeScript build)
npm pack --pack-destination "$TMPDIR" --json
TARBALL="$TMPDIR"/nativeproof-<version>.tgz

# 2. Scaffold a fresh project from the tarball
mkdir fresh-project && cd fresh-project
npm exec --yes --package="$TARBALL" -- nativeproof init --ios   # or --android

# 3. Install the packed build (init pins "latest"; override with the local tarball)
npm i -D "$TARBALL" --no-audit --no-fund

# 4. Prove the generated project loads and the CLI answers
npx tsx --eval "import('./nativeproof.config.ts').then(() => console.log('config imports cleanly'))"
npx nativeproof --help
```

For onboard changes, also run `nativeproof onboard <artifact>` against a real
`.app`/`.apk` (or an iOS source checkout) and confirm `nativeproof.config.ts`
points at the staged artifact.

Record the exact commands and their output in the PR proof section. If the
change also alters device behaviour, continue with
`.agents/skills/device-lane-proof/SKILL.md`.

## Hard Failures

- Proof produced from the repo checkout or a symlinked `node_modules` instead
  of the packed tarball.
- A generated project still depending on `"latest"` from npm during the check —
  that proves the previous release, not this change.
- Claiming "the generated project builds" with no command output to show.

## Verification

The fresh project directory contains `nativeproof.config.ts`,
`tests/example.spec.ts`, and `package.json`; the config import prints
`config imports cleanly`; `npx nativeproof --help` prints usage from the
packed CLI.
