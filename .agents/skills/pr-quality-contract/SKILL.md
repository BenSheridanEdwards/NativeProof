---
name: pr-quality-contract
description: Use before completing work or opening a PR in this repository.
---

# PR Quality Contract

## Steps

1. Read `.agents/definition_of_done.md` before implementation starts. Completion criterion: the PR scope, required proof, and verification commands are known before coding.
2. Map behavior changes to tests. Completion criterion: every user-visible behavior changed by the PR has an automated behavior/E2E test or an explicit technical reason it cannot be automated.
3. Produce behavioral proof for UI changes. Completion criterion: the PR contains current video and screenshots from the changed branch, or states `Not applicable` with the reason.
4. Run verification on the final branch. Completion criterion: format/lint/type/test/E2E commands relevant to the changed files have been run after the last code change.
5. Write the PR body using `.github/pull_request_template.md` exactly. Completion criterion: the PR body contains, in order, `Why does this feature exist?`, `What changed?`, `Behavioural Proof (with video and screenshots)`, and `Verification Summary`.
6. Do not mark work complete with placeholders. Completion criterion: every proof link, screenshot path, video path, test command, failure, skipped check, and residual risk is explicit.

## Evidence Rules

- Test claims require command output.
- UI behavior claims require screenshots or video from the branch under review.
- E2E claims require named scenarios and their pass/fail result.
- Skipped proof requires a technical reason, not convenience.
- Existing unrelated failures must be separated from failures introduced by the PR.
