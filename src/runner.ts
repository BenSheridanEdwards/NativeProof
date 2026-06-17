/**
 * BDD-runner seam.
 *
 * The fixtures and the `test` facade register suites through whatever BDD runner
 * hosts them: Mocha by default (its `describe` / `before` / `after` / `it` globals, as
 * WebdriverIO uses), or any other runner wired explicitly with {@link useRunner}
 * (for example node:test). This keeps the framework from hard-coding a single runner,
 * the way Playwright owns its own.
 */
export interface BddHooks {
  describe(title: string, fn: () => void): void;
  before(fn: () => void | Promise<void>): void;
  after(fn: () => void | Promise<void>): void;
  it(title: string, fn: () => void | Promise<void>): void;
}

let configured: BddHooks | null = null;

/** Wire an explicit BDD runner (e.g. node:test's hooks). Overrides global detection. */
export function useRunner(hooks: BddHooks): void {
  configured = hooks;
}

function fromGlobals(): BddHooks | null {
  const globals = globalThis as Record<string, unknown>;
  const { describe, before, after, it } = globals;
  if (
    typeof describe === "function" &&
    typeof before === "function" &&
    typeof after === "function" &&
    typeof it === "function"
  ) {
    return {
      describe: describe as BddHooks["describe"],
      before: before as BddHooks["before"],
      after: after as BddHooks["after"],
      it: it as BddHooks["it"],
    };
  }
  return null;
}

/** The active BDD runner: the one set via {@link useRunner}, else the ambient globals. */
export function runner(): BddHooks {
  const hooks = configured ?? fromGlobals();
  if (!hooks) {
    throw new Error(
      "No BDD runner found. Run under Mocha (WebdriverIO's default) or call useRunner({ describe, before, after, it }) — e.g. with node:test's hooks.",
    );
  }
  return hooks;
}
