import { type BehaviourRegistrar, describeScenario, type ScenarioFixture } from "./fixtures.js";

/**
 * The Playwright-flavoured test surface.
 *
 * `test.describe(title, scenario, (test) => { test("…", async ({ … }) => …) })` binds a
 * scenario's fixture context to a block; each `test(name, body)` is one behaviour with
 * that context injected — fully typed, with no setup/teardown in the spec. The registrar
 * is passed into the block (rather than being a module global) so the fixture context
 * types flow into every body; otherwise it reads like Playwright.
 */
export const test = {
  describe<Ctx>(
    title: string,
    scenario: ScenarioFixture<Ctx>,
    define: (test: BehaviourRegistrar<Ctx>) => void,
  ): void {
    describeScenario(title, scenario, define);
  },
};
