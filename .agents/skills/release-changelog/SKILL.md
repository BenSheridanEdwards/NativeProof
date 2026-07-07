---
name: release-changelog
description: Use when cutting a NativeProof release, bumping the package version, or writing a CHANGELOG entry. Covers the Keep a Changelog entry format and the GitHub-Release-driven npm publish flow.
---

# Release & Changelog

Publishing is CI-owned: cutting a GitHub Release (or a manual run of the
`publish` workflow) runs `npm run check` + `npm test` on a clean checkout and
then `npm publish`. Never publish from a laptop — that skips the clean-checkout
gate and the Automation-token auth.

## Required Pattern

1. Bump `version` in `package.json` following semver.

2. Add a CHANGELOG entry at the top, matching the existing house style:

   ```md
   ## <version>

   One headline sentence naming the release's main story.

   **Added**

   - Consumer-visible additions, written for the person running NativeProof.

   **Changed**

   - Behaviour changes and their reason.

   **Fixed**

   - Bugs fixed, described by symptom.
   ```

   Include only the groups that apply. Minor releases lead with the headline
   sentence; a patch-only entry may go straight to the groups. Write entries
   for consumers, not for reviewers of the diff — name the command or API a
   user touches.

3. Land the bump + changelog on `main` through a normal PR (all Definition of
   Done gates apply).

4. Cut a GitHub Release with the tag equal to the version (e.g. `0.10.15`)
   targeting the merged commit on `main`. Publishing then happens in
   `.github/workflows/publish.yml`; watch the run to completion.

## Hard Failures

- `npm publish` run locally.
- A release tag that does not match `package.json` `version`.
- A version bump with no CHANGELOG entry.
- Cutting the release before the bump PR is merged and green.

## Verification

`npm view nativeproof version` reports the new version after the publish
workflow succeeds, and the CHANGELOG's top entry matches the released tag.
