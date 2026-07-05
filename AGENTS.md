# NativeProof Agent Instructions

Read `.agents/NORTH_STAR_GOAL.md` and `.agents/DEFINITION_OF_DONE.md` before changing this repository.

The short version: NativeProof should be Playwright-feeling native E2E, not a new test framework.
Prefer one-command setup, runner-native `describe`/`it`, direct `native.*` interactions, plain
`expect`, and one `nativeproof.config.ts` that owns all device/app control. Do not add or promote
public `test.*` facades.

## Simplicity Mode

Use Ponytail for coding, review, refactor, and design tasks unless the user says
otherwise. Default level: `full`: delete code, reuse existing patterns, and use
stdlib or native platform features before adding abstractions or dependencies.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **NativeProof** (909 symbols, 2396 relationships, 78 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/NativeProof/context` | Codebase overview, check index freshness |
| `gitnexus://repo/NativeProof/clusters` | All functional areas |
| `gitnexus://repo/NativeProof/processes` | All execution flows |
| `gitnexus://repo/NativeProof/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
