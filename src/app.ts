import type { Driver } from "./driver.js";
import type { FailureInfo, ScenarioFixture } from "./fixtures.js";
import type { SessionMock } from "./mock.js";

/**
 * `defineApp` — the advanced fixture seam.
 *
 * New specs should usually keep app/device control in `nativeproof.config.ts` via `createNative`.
 * `defineApp` remains for fixture-heavy suites that need shared session setup: how to get the
 * device, how to start the mock backend, secret/redaction patterns, login/join flows, and screen
 * objects. The framework core imports nothing from the app; the app describes itself here once.
 * `app.session(role)` turns that into a {@link ScenarioFixture} for the legacy/advanced harness.
 */

/**
 * The device handles every session provides before app screens are layered on.
 * Generic over the mock type `M` (default {@link SessionMock}) so an app with a richer
 * mock — extra socket/presence controls beyond the base contract — gets `mock` typed as
 * that richer type throughout, with no casts. The constraint is `SessionMock` (frames + stop),
 * not the full `MockBackend`, so a mock that doesn't implement `route()` still works.
 */
export interface DeviceContext<M extends SessionMock = SessionMock> {
  driver: Driver;
  mock: M;
}

/** A screen-object factory: given the device context, build that screen's locators/actions. */
export type ScreenFactory<S, M extends SessionMock = SessionMock> = (context: DeviceContext<M>) => S;
export type ScreenFactories<M extends SessionMock = SessionMock> = Record<string, ScreenFactory<unknown, M>>;

/** Context passed to the login/join flows. */
export type FlowContext<M extends SessionMock = SessionMock> = DeviceContext<M> & { role: string };

export interface AppDefinition<S extends ScreenFactories<M>, M extends SessionMock = SessionMock> {
  /** Acquire the device/driver (e.g. wdioDriver()). */
  driver: () => Driver | Promise<Driver>;
  /** Start the app's mock backend (its concrete type `M` flows through the whole session). */
  mock: () => M | Promise<M>;
  /** App-specific secret patterns to keep out of evidence (injected, never baked into the core). */
  secrets?: readonly RegExp[];
  /** App-specific evidence-redaction patterns. */
  redact?: readonly RegExp[];
  /** Reach a logged-in state for the role. */
  login?: (context: NoInfer<FlowContext<M>>) => Promise<void>;
  /** Enter the role's main surface. */
  join?: (context: NoInfer<FlowContext<M>>) => Promise<void>;
  /** Screen-object factories, bound to the device context. `S` (and so the whole context) is
   *  inferred from here. */
  screens: S;
  /**
   * Release app-level resources acquired across the session, run on teardown BEFORE the
   * mock stops and before the runner deletes the device session — e.g. force-stop the app
   * so its background sockets are gone before `deleteSession`. The mock is still stopped
   * even if this throws.
   *
   * The context is wrapped in `NoInfer` so passing a `teardown` does NOT drive `S` inference —
   * otherwise this S-dependent parameter co-infers with `screens` and collapses `S` to its
   * `ScreenFactories<M>` constraint (screens → `unknown`) in the exported context type.
   */
  teardown?: (context: NoInfer<SessionContext<S, M>>) => Promise<void> | void;
  /**
   * Invoked when a behaviour throws, before the failure propagates — wire on-failure
   * evidence here (e.g. `captureState(...)`) so capture lives in one place, not in every
   * behaviour. Its own errors are swallowed so they never mask the real failure. `NoInfer` for the
   * same reason as `teardown` — this parameter must not participate in inferring `S`.
   */
  onFailure?: (context: NoInfer<SessionContext<S, M>>, info: FailureInfo) => Promise<void> | void;
}

/** Eagerly flatten an intersection into one object type, so the resolved context ports cleanly. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The fixture context a session injects: the device handles plus each app screen's value. Flattened
 * with {@link Prettify} so it is a single object type rather than a lazy intersection — that lets
 * legacy harness exports carry fully-typed screens into specs in other files. (Portability still
 * needs the mock type `M` to be nameable — a single exported interface, not an anonymous
 * intersection — so a consumer's mock should be one named type.)
 */
export type SessionContext<S extends ScreenFactories<M>, M extends SessionMock = SessionMock> = Prettify<
  DeviceContext<M> & {
    [K in keyof S]: ReturnType<S[K]>;
  }
>;

/**
 * Parameterised by the *resolved* session context `Ctx` (`{ driver; mock; …screens }`), not by
 * the screens type `S`. `S` is only ever used inside the mapped `SessionContext<S, M>`, a
 * non-inferable position — so a legacy harness export would lose the concrete screen return types
 * across the import boundary (TS falls back to the `ScreenFactories<M>` constraint, whose screens
 * are `unknown`). `defineApp` resolves the context here, where `S` is still concrete, so `Ctx` is a
 * plain object type that ports cleanly into specs.
 */
export interface App<Ctx> {
  /** A scenario fixture that provisions a logged-in, joined session for `role`. */
  session(role?: string): ScenarioFixture<Ctx>;
}

export function defineApp<S extends ScreenFactories<M>, M extends SessionMock = SessionMock>(
  definition: AppDefinition<S, M>,
): App<SessionContext<S, M>> {
  return {
    session(role = "default"): ScenarioFixture<SessionContext<S, M>> {
      return {
        async setup(): Promise<SessionContext<S, M>> {
          const driver = await definition.driver();
          const mock = await definition.mock();
          const device: DeviceContext<M> = { driver, mock };
          try {
            if (definition.login) await definition.login({ ...device, role });
            if (definition.join) await definition.join({ ...device, role });
            const screens: Record<string, unknown> = {};
            const factories = Object.entries(definition.screens) as [string, ScreenFactory<unknown, M>][];
            for (const [name, factory] of factories) {
              screens[name] = factory(device);
            }
            // Dynamic assembly: the screen factories' precise return types are
            // recovered by SessionContext<S>, so the boundary cast is the honest seam.
            return { ...device, ...screens } as unknown as SessionContext<S, M>;
          } catch (error) {
            await mock.stop().catch(() => {});
            throw error;
          }
        },
        async teardown(context): Promise<void> {
          if (!context) return;
          try {
            await definition.teardown?.(context);
          } finally {
            await context.mock.stop();
          }
        },
        ...(definition.onFailure ? { onFailure: definition.onFailure } : {}),
      };
    },
  };
}
