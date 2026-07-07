import type { Driver } from "./driver.js";
import type { Locator, Selector, TapOptions, WaitOptions } from "./locator.js";
import { type Page, page } from "./page.js";

export interface NativeNavigateContext {
  driver: Driver;
  native: Native;
}

export interface NativeLaunchContext {
  driver: Driver;
  native: Native;
}

export interface NativeOptions {
  /** The live driver. Production usually returns `wdioDriver()`. */
  driver: () => Driver;
  /**
   * App-specific navigation. Keep this in `nativeproof.config.ts`, where app control belongs.
   * Typical implementations use a deep link, app reset, mock-backend state, or an installed app route.
   */
  navigate?: (route: string, context: NativeNavigateContext) => void | Promise<void>;
  /**
   * Optional app launch/reset hook for visible setup in specs, e.g. `beforeEach(() =>
   * native.launch({ route: "/login", reset: true }))`.
   */
  launch?: (
    options: Record<string, unknown> | undefined,
    context: NativeLaunchContext,
  ) => void | Promise<void>;
}

export interface Native extends Page {
  /** Escape hatch for app-specific setup that still needs the underlying device driver. */
  driver(): Driver;
  /** Navigate through the app-specific route hook defined in `nativeproof.config.ts`. */
  navigate(route: string): Promise<void>;
  /** Launch/reset through the app-specific hook defined in `nativeproof.config.ts`. */
  launch(options?: Record<string, unknown>): Promise<void>;
  /** Tap visible text directly; for more control, use `native.getByText(...).tap()`. */
  tap(text: string | RegExp, options?: TapOptions): Promise<void>;
  /** Fill a field found by visible text/label. */
  fill(label: string | RegExp, text: string, options?: WaitOptions): Promise<void>;
}

function missingHook(name: "navigate" | "launch", detail: string): Error {
  return new Error(
    `native.${name}(${detail}) is not configured. Add ${name}(...) in nativeproof.config.ts so app control stays in one place.`,
  );
}

/**
 * A tiny native-app control surface for runner-native specs.
 *
 * NativeProof owns the boring cross-platform primitives (`getByText`, `tap`, `expect`); the app owns
 * routing, reset, and launch behaviour in `nativeproof.config.ts`.
 */
export function createNative(options: NativeOptions): Native {
  let native: Native;
  const driver = (): Driver => options.driver();
  const currentPage = (): Page => page(driver());
  const context = (): NativeNavigateContext => ({ driver: driver(), native });

  native = {
    driver,
    locator: (selector: Selector, waitOptions: WaitOptions = {}): Locator =>
      currentPage().locator(selector, waitOptions),
    getByText: (text: string | RegExp, waitOptions: WaitOptions = {}): Locator =>
      currentPage().getByText(text, waitOptions),
    getByTestId: (testId: string | RegExp, waitOptions: WaitOptions = {}): Locator =>
      currentPage().getByTestId(testId, waitOptions),
    getByLabel: (label: string | RegExp, waitOptions: WaitOptions = {}): Locator =>
      currentPage().getByLabel(label, waitOptions),
    getById: (id: string | RegExp, waitOptions: WaitOptions = {}): Locator =>
      currentPage().getById(id, waitOptions),
    getByRole: (role: string, waitOptions: Parameters<Page["getByRole"]>[1] = {}): Locator =>
      currentPage().getByRole(role, waitOptions),
    async navigate(route: string): Promise<void> {
      if (!options.navigate) throw missingHook("navigate", JSON.stringify(route));
      await options.navigate(route, context());
    },
    async launch(launchOptions?: Record<string, unknown>): Promise<void> {
      const detail = launchOptions === undefined ? "" : JSON.stringify(launchOptions);
      if (!options.launch) throw missingHook("launch", detail);
      await options.launch(launchOptions, context());
    },
    async tap(text: string | RegExp, tapOptions: TapOptions = {}): Promise<void> {
      await native.getByText(text).tap({ clickableAncestor: true, ...tapOptions });
    },
    async fill(label: string | RegExp, text: string, waitOptions: WaitOptions = {}): Promise<void> {
      await native.getByRole("textfield", waitOptions).near(native.getByText(label)).fill(text, waitOptions);
    },
  };

  return native;
}
