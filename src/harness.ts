import type { App, ScreenFactories, SessionContext } from "./app.js";
import { expect } from "./expect.js";
import { type BehaviourRegistrar, describeScenario } from "./fixtures.js";
import type { SessionMock } from "./mock.js";

/**
 * `createHarness(app)` — the Playwright `@playwright/test` pattern.
 *
 * Returns a `test` / `expect` pair bound to one app, so specs import them from a single
 * project file and write module-level `test(...)` / `test.describe(...)` with the app's
 * fixture context flowing in fully typed — no `(test) =>` registrar to thread, no
 * per-spec wiring:
 *
 * ```ts
 * // harness.ts
 * export const { test, expect } = createHarness(app);
 * // chat.spec.ts
 * import { test, expect } from "./harness";
 * test.describe("chat room", "member", () => {
 *   test("renders the latest message", async ({ member, mock }) => { ... });  // typed
 * });
 * ```
 */
export interface HarnessTest<S extends ScreenFactories<M>, M extends SessionMock = SessionMock> {
  (name: string, body: (context: SessionContext<S, M>) => void | Promise<void>): void;
  /** Open a scenario block for the default role. */
  describe(title: string, body: () => void): void;
  /** Open a scenario block for a specific role (e.g. "member" / "guest"). */
  describe(title: string, role: string, body: () => void): void;
  /** Run before each behaviour in the open scenario, with the session context injected. */
  beforeEach(body: (context: SessionContext<S, M>) => void | Promise<void>): void;
  /** Run after each behaviour in the open scenario, with the session context injected. */
  afterEach(body: (context: SessionContext<S, M>) => void | Promise<void>): void;
}

export interface Harness<S extends ScreenFactories<M>, M extends SessionMock = SessionMock> {
  test: HarnessTest<S, M>;
  expect: typeof expect;
}

export function createHarness<S extends ScreenFactories<M>, M extends SessionMock = SessionMock>(
  app: App<S, M>,
): Harness<S, M> {
  let active: BehaviourRegistrar<SessionContext<S, M>> | null = null;

  const test = ((name: string, body: (context: SessionContext<S, M>) => void | Promise<void>): void => {
    if (!active) {
      throw new Error(`test(${JSON.stringify(name)}) must be called inside test.describe(...)`);
    }
    active(name, body);
  }) as HarnessTest<S, M>;

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
  }) as HarnessTest<S, M>["describe"];

  const requireActive = (hook: string): BehaviourRegistrar<SessionContext<S, M>> => {
    if (!active) {
      throw new Error(`test.${hook}(...) must be called inside test.describe(...)`);
    }
    return active;
  };
  test.beforeEach = (body) => requireActive("beforeEach").beforeEach(body);
  test.afterEach = (body) => requireActive("afterEach").afterEach(body);

  return { test, expect };
}
