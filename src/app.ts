import type { Driver } from "./driver.js";
import type { ScenarioFixture } from "./fixtures.js";
import type { MockBackend } from "./mock.js";

/**
 * `defineApp` — the single seam script.
 *
 * Everything app-specific the framework needs lives in one declarative definition,
 * supplied by injection: how to get the device, how to start the mock backend, the
 * secret/redaction patterns, the login/join flows, and the screen objects. The
 * framework core imports nothing from the app; the app describes itself here once.
 * `app.session(role)` turns that into a {@link ScenarioFixture} the `test` facade runs.
 */

/** The device handles every session provides before app screens are layered on. */
export interface DeviceContext {
  driver: Driver;
  mock: MockBackend;
}

/** A screen-object factory: given the device context, build that screen's locators/actions. */
export type ScreenFactory<S> = (context: DeviceContext) => S;
export type ScreenFactories = Record<string, ScreenFactory<unknown>>;

/** Context passed to the login/join flows. */
export type FlowContext = DeviceContext & { role: string };

export interface AppDefinition<S extends ScreenFactories> {
  /** Acquire the device/driver (e.g. wdioDriver()). */
  driver: () => Driver | Promise<Driver>;
  /** Start the app's mock backend. */
  mock: () => MockBackend | Promise<MockBackend>;
  /** App-specific secret patterns to keep out of evidence (injected, never baked into the core). */
  secrets?: readonly RegExp[];
  /** App-specific evidence-redaction patterns. */
  redact?: readonly RegExp[];
  /** Reach a logged-in state for the role. */
  login?: (context: FlowContext) => Promise<void>;
  /** Enter the role's main surface. */
  join?: (context: FlowContext) => Promise<void>;
  /** Screen-object factories, bound to the device context. */
  screens: S;
}

/** The fixture context a session injects: the device handles plus each app screen. */
export type SessionContext<S extends ScreenFactories> = DeviceContext & {
  [K in keyof S]: ReturnType<S[K]>;
};

export interface App<S extends ScreenFactories> {
  /** A scenario fixture that provisions a logged-in, joined session for `role`. */
  session(role?: string): ScenarioFixture<SessionContext<S>>;
}

export function defineApp<S extends ScreenFactories>(definition: AppDefinition<S>): App<S> {
  return {
    session(role = "default"): ScenarioFixture<SessionContext<S>> {
      return {
        async setup(): Promise<SessionContext<S>> {
          const driver = await definition.driver();
          const mock = await definition.mock();
          const device: DeviceContext = { driver, mock };
          try {
            if (definition.login) await definition.login({ ...device, role });
            if (definition.join) await definition.join({ ...device, role });
            const screens: Record<string, unknown> = {};
            for (const [name, factory] of Object.entries(definition.screens)) {
              screens[name] = factory(device);
            }
            // Dynamic assembly: the screen factories' precise return types are
            // recovered by SessionContext<S>, so the boundary cast is the honest seam.
            return { ...device, ...screens } as unknown as SessionContext<S>;
          } catch (error) {
            await mock.stop().catch(() => {});
            throw error;
          }
        },
        async teardown(context): Promise<void> {
          if (context) await context.mock.stop();
        },
      };
    },
  };
}
