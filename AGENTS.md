# NativeProof Agent Instructions

Read `.agents/NORTH_STAR_GOAL.md` and `.agents/DEFINITION_OF_DONE.md` before changing this repository.

The short version: NativeProof should be Playwright-feeling native E2E, not a new test framework.
Prefer one-command setup, runner-native `describe`/`it`, direct `native.*` interactions, plain
`expect`, and one `nativeproof.config.ts` that owns all device/app control. Do not add or promote
public `test.*` facades.

## PR Proof Law

Before opening, updating, or marking a PR ready, read
`.agents/DEFINITION_OF_DONE.md` and
`.agents/skills/pr-inline-screenshot-proof/SKILL.md`.

- Screenshot proof must be committed to the branch and embedded inline in the PR
  body with `![alt](...png?raw=1)`.
- Bare screenshot links, local paths, relative paths, and placeholders are not
  proof.
- If no rendered or behavioural proof applies, write `Not applicable` with the
  technical reason in the PR proof section.
