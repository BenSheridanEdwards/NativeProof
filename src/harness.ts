import type { App } from "./app.js";
import { expect } from "./expect.js";
import { type BehaviourRegistrar, describeScenario } from "./fixtures.js";

/**
 * `createHarness(app)` — legacy/advanced scenario fixture harness.
 *
 * New specs should prefer runner-native `describe` / `it`, direct `native.*` interactions, and
 * visible setup in the spec. This helper remains for fixture-heavy suites where a shared scenario
 * context is genuinely clearer than repeated visible setup:
 *
 * ```ts
 * // compatibility-harness.ts
 * export const { test, expect } = createHarness(app);
 * // chat.spec.ts
 * import { test, expect } from "./harness";
 * test.describe("chat room", "member", () => {
 *   test("renders the latest message", async ({ member, mock }) => { ... });  // typed
 * });
 * ```
 */
/**
 * Parameterised by the *resolved* session context `Ctx`, not by the screens type `S`. When a
 * project does `export const { test } = createHarness(app)` and a spec in another file imports
 * `test`, TS computes the portable exported type — and if the harness were parameterised by
 * `S extends ScreenFactories<M>`, it would write the **constraint** (`ScreenFactories<M>`, whose
 * screens return `unknown`) instead of the concrete `S`, so every imported behaviour's context
 * would be `unknown`. `Ctx` is already the concrete object (`{ driver; mock; …screens }`), so the
 * screen return types survive the boundary and behaviours stay fully typed.
 */
export interface HarnessTest<Ctx> {
  (name: string, body: (context: Ctx) => void | Promise<void>): void;
  /** Open a scenario block for the default role. */
  describe(title: string, body: () => void): void;
  /** Open a scenario block for a specific role (e.g. "member" / "guest"). */
  describe(title: string, role: string, body: () => void): void;
  /** Run before each behaviour in the open scenario, with the session context injected. */
  beforeEach(body: (context: Ctx) => void | Promise<void>): void;
  /** Run after each behaviour in the open scenario, with the session context injected. */
  afterEach(body: (context: Ctx) => void | Promise<void>): void;
}

export interface Harness<Ctx> {
  test: HarnessTest<Ctx>;
  expect: typeof expect;
}

export function createHarness<Ctx>(app: App<Ctx>): Harness<Ctx> {
  let active: BehaviourRegistrar<Ctx> | null = null;

  const test = ((name: string, body: (context: Ctx) => void | Promise<void>): void => {
    if (!active) {
      throw new Error(`test(${JSON.stringify(name)}) must be called inside test.describe(...)`);
    }
    active(name, body);
  }) as HarnessTest<Ctx>;

  test.describe = ((title: string, roleOrBody: string | (() => void), maybeBody?: () => void): void => {
    const role = typeof roleOrBody === "string" ? roleOrBody : undefined;
    const body = typeof roleOrBody === "function" ? roleOrBody : maybeBody;
    if (!body) {
      throw new Error(`test.describe(${JSON.stringify(title)}) requires a body function`);
    }
    describeScenario(title, app.session(role), (register) => {
      const previous = active;
      active = register;
      try {
        body();
      } finally {
        active = previous;
      }
    });
  }) as HarnessTest<Ctx>["describe"];

  const requireActive = (hook: string): BehaviourRegistrar<Ctx> => {
    if (!active) {
      throw new Error(`test.${hook}(...) must be called inside test.describe(...)`);
    }
    return active;
  };
  test.beforeEach = (body) => requireActive("beforeEach").beforeEach(body);
  test.afterEach = (body) => requireActive("afterEach").afterEach(body);

  return { test, expect };
}
