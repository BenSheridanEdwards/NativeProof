/**
 * BDD-runner seam.
 *
 * The fixtures and the `test` facade register suites through whatever BDD runner
 * hosts them: Mocha by default (its `describe` / `before` / `after` / `it` globals, as
 * WebdriverIO uses), or any other runner wired explicitly with {@link useRunner}
 * (for example node:test). This keeps the framework from hard-coding a single runner,
 * the way Playwright owns its own.
 */
/** A per-behaviour hook (`beforeEach` / `afterEach`). */
type PerTestHook = (fn: (this: BddContext) => void | Promise<void>) => void;

/** Minimal runner context NativeProof needs from Mocha-like hosts. */
export interface BddContext {
  /** Mark the current suite/test skipped when the host runner supports it. */
  skip?(): void;
}

export interface BddHooks {
  describe(title: string, fn: () => void): void;
  before(fn: (this: BddContext) => void | Promise<void>): void;
  after(fn: (this: BddContext) => void | Promise<void>): void;
  /** Optional per-behaviour hooks; present on Mocha and node:test. */
  beforeEach?(fn: (this: BddContext) => void | Promise<void>): void;
  afterEach?(fn: (this: BddContext) => void | Promise<void>): void;
  it(title: string, fn: (this: BddContext) => void | Promise<void>): void;
}

let configured: BddHooks | null = null;

/** Wire an explicit BDD runner (e.g. node:test's hooks). Overrides global detection. */
export function useRunner(hooks: BddHooks): void {
  configured = hooks;
}

function fromGlobals(): BddHooks | null {
  const globals = globalThis as Record<string, unknown>;
  const { describe, before, after, beforeEach, afterEach, it } = globals;
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
      ...(typeof beforeEach === "function" ? { beforeEach: beforeEach as PerTestHook } : {}),
      ...(typeof afterEach === "function" ? { afterEach: afterEach as PerTestHook } : {}),
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
