# Definition Of Done

A NativeProof change is done only when the local proof matches the claim.

## Required Checks

- Run `npm run check`.
- Run `npm test`.
- For generated project or CLI changes, prove the generated project still builds or explain the
  exact unverified surface.
- For device/Appium behaviour changes, run the focused device lane or state why it was not run.

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
