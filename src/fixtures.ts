/**
 * Playwright-style behaviour fixtures for Appium/WebdriverIO + Mocha.
 *
 * Gives specs the developer experience of Playwright — a typed fixture context
 * injected into each behaviour, with provisioning and teardown owned by the
 * framework instead of copy-pasted into every `before`/`after` — without depending
 * on Playwright itself (which cannot drive native iOS/Android). It is a thin layer
 * over whatever BDD runner hosts it (Mocha by default; see {@link runner}).
 *
 * App-agnostic by contract: nothing here may import app-specific code. A caller
 * supplies a {@link ScenarioFixture} describing how to provision and tear down its
 * own context (start a mock, relaunch the app, log in, join …); this module only
 * wires that lifecycle into the runner and injects the result. It is part of the
 * surface intended for extraction into a standalone package.
 */

import { type BddHooks, runner } from "./runner.js";

/**
 * Provisioning + teardown for one behaviour scenario's shared fixture context.
 *
 * The context is provisioned ONCE per scenario (Mocha `before`) and shared across
 * its ordered behaviours, then torn down ONCE (`after`) — the analogue of a
 * Playwright scoped fixture or `describe.serial`. This suits stateful mobile
 * sessions where a single login+join underpins many in-session behaviours:
 * re-provisioning per behaviour would be prohibitively slow and would change what
 * is asserted, because the behaviours accumulate session state in a deliberate
 * order. A per-behaviour-isolation mode can layer on later for stateless scenarios
 * without changing this contract.
 *
 * @typeParam Ctx - the fixture context injected into each behaviour.
 */
export interface ScenarioFixture<Ctx> {
  /** Provision the shared context (e.g. start mock, relaunch app, log in, join). */
  setup(): Promise<Ctx>;
  /**
   * Release everything {@link ScenarioFixture.setup} acquired. Always invoked, even
   * when `setup` threw partway, so it receives `undefined` if no context was
   * produced and must be safe to call in that state.
   */
  teardown(context: Ctx | undefined): Promise<void>;
}

/**
 * Registers one behaviour. The provisioned context is injected, so the body is pure
 * behaviour — no `before`/`after`, no threading a backend handle through assertions.
 * Read it Playwright-style: destructure the fixtures the behaviour needs.
 */
export interface BehaviourRegistrar<Ctx> {
  /** Register one behaviour; the provisioned context is injected into its body. */
  (title: string, body: (context: Ctx) => void | Promise<void>): void;
  /** Run before each behaviour in the scenario, with the provisioned context. */
  beforeEach(body: (context: Ctx) => void | Promise<void>): void;
  /** Run after each behaviour in the scenario, with the provisioned context. */
  afterEach(body: (context: Ctx) => void | Promise<void>): void;
}

/**
 * Define a behaviour scenario: a Mocha `describe` whose fixture context is
 * provisioned once, injected into every behaviour, and torn down once.
 *
 * @param title   - the scenario description (Mocha `describe` title).
 * @param fixture - how to provision and tear down the shared context.
 * @param define  - registers the behaviours; receives a `test` registrar that
 *                  injects the context.
 *
 * @example
 * describeScenario("chat room", chatRoomScenario(), (test) => {
 *   test("renders the latest message", async ({ member }) => {
 *     await member.assertLatestMessageVisible();
 *   });
 * });
 */
export function describeScenario<Ctx>(
  title: string,
  fixture: ScenarioFixture<Ctx>,
  define: (test: BehaviourRegistrar<Ctx>) => void,
): void {
  const hooks = runner();
  const { describe, before, after, it } = hooks;
  describe(title, () => {
    let context: Ctx | undefined;

    before(async () => {
      context = await fixture.setup();
    });

    after(async () => {
      await fixture.teardown(context);
    });

    const requireContext = (): Ctx => {
      if (context === undefined) {
        throw new Error(`Scenario "${title}" ran a behaviour before its fixture context was provisioned`);
      }
      return context;
    };

    const registerHook = (
      hook: BddHooks["beforeEach"],
      name: string,
      body: (context: Ctx) => void | Promise<void>,
    ): void => {
      if (!hook) {
        throw new Error(`The active runner has no ${name} hook; scenario ${name} is unavailable`);
      }
      hook(async () => {
        await body(requireContext());
      });
    };

    const test = ((behaviourTitle: string, body: (context: Ctx) => void | Promise<void>): void => {
      it(behaviourTitle, async () => {
        await body(requireContext());
      });
    }) as BehaviourRegistrar<Ctx>;

    test.beforeEach = (body) => registerHook(hooks.beforeEach, "beforeEach", body);
    test.afterEach = (body) => registerHook(hooks.afterEach, "afterEach", body);

    define(test);
  });
}
