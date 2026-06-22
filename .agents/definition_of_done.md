# Definition of Done

A completed PR must contain the items below. If an item does not apply, the PR must state `Not applicable` and give the technical reason.

## Required PR Body

The PR body must use `.github/pull_request_template.md` and preserve these sections in this order:

1. `Why does this feature exist?`
2. `What changed?`
3. `Behavioural Proof (with video and screenshots)`
4. `Verification Summary`

## Scope and Implementation

- The reason for the change is stated in user, product, or technical terms.
- The changed files and behavior are summarized precisely.
- The implementation avoids unrelated refactors, formatting churn, and hidden scope expansion.
- New configuration, migrations, permissions, dependencies, or public API changes are called out.

## Behavioural Proof

- UI behavior changes include screenshots from the branch under review.
- Flows with motion, timing, cursor behavior, audio, or multi-step interaction include video when practical.
- Screenshots and videos must show the changed behavior, not a generic happy path.
- Behaviour/E2E tests map to the user-visible behavior changed by the PR.
- Missing visual proof or E2E coverage is allowed only with a technical reason and a stated replacement verification method.

## Verification

- Format, lint, typecheck, unit, integration, and E2E checks relevant to the changed files are run after the final code change.
- Test command names and pass/fail results are listed in the PR.
- Existing unrelated failures are separated from failures introduced by the PR.
- Any skipped check includes the reason, risk, and owner for follow-up.

## Review Readiness

- Documentation is updated when behavior, setup, or operation changes.
- Security, privacy, data retention, accessibility, and performance effects are considered when relevant.
- The PR does not contain secrets, local-only paths, generated junk, or unrelated artifacts.
- The branch is ready for review only when the PR body contains concrete evidence, not placeholders.
