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

import { type BddContext, type BddHooks, runner } from "./runner.js";

/** Error thrown by {@link skipScenario}; public so consumers can identify it if needed. */
export class ScenarioSkipError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ScenarioSkipError";
  }
}

/**
 * Skip the current scenario from fixture setup.
 *
 * Use this when a mobile scenario depends on an optional app seam, simulator state,
 * native build marker, or device capability. It mirrors Playwright's "assumption"
 * shape at the scenario-fixture boundary: the fixture owns the precondition and
 * the behaviours remain clean.
 */
export function skipScenario(reason: string): never {
  throw new ScenarioSkipError(reason);
}

function isScenarioSkip(error: unknown): error is ScenarioSkipError {
  return error instanceof ScenarioSkipError;
}

function skipCurrent(runnerContext: BddContext, reason: string): void {
  if (typeof runnerContext.skip === "function") {
    runnerContext.skip();
    return;
  }
  console.warn(`[nativeproof] scenario skipped but the active runner has no skip(): ${reason}`);
}

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
  /**
   * Invoked when a behaviour throws, before the failure propagates — the seam for
   * on-failure evidence (e.g. `captureState(...)`), so capture lives here instead of in
   * every behaviour. Receives the provisioned context and the failing behaviour's title +
   * error. Its own errors are swallowed (logged) so they never mask the real failure.
   */
  onFailure?(context: Ctx, info: FailureInfo): void | Promise<void>;
}

/** The failing behaviour's title and the error it threw. */
export interface FailureInfo {
  title: string;
  error: unknown;
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
    let skippedReason: string | undefined;

    before(async function () {
      try {
        context = await fixture.setup();
      } catch (error) {
        if (!isScenarioSkip(error)) throw error;
        skippedReason = error.reason;
        skipCurrent(this, error.reason);
      }
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
      hook(async function () {
        if (skippedReason) {
          skipCurrent(this, skippedReason);
          return;
        }
        await body(requireContext());
      });
    };

    const test = ((behaviourTitle: string, body: (context: Ctx) => void | Promise<void>): void => {
      it(behaviourTitle, async function () {
        if (skippedReason) {
          skipCurrent(this, skippedReason);
          return;
        }
        const context = requireContext();
        try {
          await body(context);
        } catch (error) {
          if (fixture.onFailure) {
            try {
              await fixture.onFailure(context, { title: behaviourTitle, error });
            } catch (hookError) {
              console.warn(`[nativeproof] onFailure hook threw (ignored): ${hookError}`);
            }
          }
          throw error;
        }
      });
    }) as BehaviourRegistrar<Ctx>;

    test.beforeEach = (body) => registerHook(hooks.beforeEach, "beforeEach", body);
    test.afterEach = (body) => registerHook(hooks.afterEach, "afterEach", body);

    define(test);
  });
}
