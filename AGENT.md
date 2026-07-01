# NativeProof Agent Instructions

Read `.agents/NORTH_STAR_GOAL.md` before changing this repository.

The short version: NativeProof should be Playwright-feeling native E2E, not a new test framework.
Prefer one-command setup, runner-native `describe`/`it`, direct `native.*` interactions, plain
`expect`, and one `nativeproof.config.ts` that owns all device/app control. Do not add or promote
public `test.*` facades.
