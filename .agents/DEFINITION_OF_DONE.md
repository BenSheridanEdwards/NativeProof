# Definition Of Done

A NativeProof change is done only when the local proof matches the claim.

## Required Checks

- Run `npm run check`.
- Run `npm test`.
- For generated project or CLI changes, prove the generated project still builds or explain the
  exact unverified surface (see `.agents/skills/verify-generated-project/SKILL.md`).
- For device/Appium behaviour changes, run the focused device lane or state why it was not run
  (see `.agents/skills/device-lane-proof/SKILL.md`).

## Local Gates

- Pre-commit runs `npm run check`.
- Pre-push runs `npm test`.
- CI reruns both checks on a clean checkout.

## PR Standard

- Open ready PRs, not draft PRs.
- Use the PR template.
- Include exact commands run and whether they passed.
- Include generated-project or device proof when the change affects those paths.
- Do not mark a PR ready while GitHub checks are queued or running.

## Inline PR Proof Law

Every PR must follow `.agents/skills/pr-inline-screenshot-proof/SKILL.md`.

- The PR body must use `.github/PULL_REQUEST_TEMPLATE.md`; that template carries this same proof law.
- Screenshot proof must be committed to the branch, normally under `docs/proof/<short-scope>/`.
- The PR body must embed screenshots inline with Markdown image syntax:
  `![Descriptive alt text](https://github.com/OWNER/REPO/blob/BRANCH/docs/proof/SCOPE/file.png?raw=1)`.
- Bare screenshot links, local filesystem paths, relative paths, and "see attached" placeholders do not satisfy proof.
- Video or non-image artifacts may be linked, but screenshots must render inline in the PR description.
- After creating or editing the PR, inspect the body with `gh pr view <number> --json body --jq .body` and confirm screenshot proof contains `![`.
- If no rendered or behavioural proof applies, the PR must say `Not applicable` in the proof section with the technical reason.
