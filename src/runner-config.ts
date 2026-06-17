import { pathToFileURL } from "node:url";
import { buildWdioConfig, type NativeProofConfig, type RunnerEnv } from "./config.js";

/**
 * The bridge the `nativeproof` CLI hands to WebdriverIO: it loads the user's
 * `nativeproof.config.ts` (path in `NATIVEPROOF_CONFIG`) and exports the synthesised `config`.
 * The CLI runs `wdio run <this file>` with `--import tsx`, so the TS config loads.
 * Not part of the public API — it is the runner entry point.
 */
const configPath = process.env.NATIVEPROOF_CONFIG;
if (!configPath) {
  throw new Error("NATIVEPROOF_CONFIG is not set — run NativeProof through the `nativeproof` CLI");
}

const loaded = (await import(pathToFileURL(configPath).href)) as { default?: NativeProofConfig };
const userConfig = loaded.default;
if (!userConfig) {
  throw new Error(`${configPath} must \`export default defineConfig(...)\``);
}

const env: RunnerEnv = {};
const { PLATFORM, NATIVEPROOF_PROJECT, SPEC, APPIUM_HOST, APPIUM_PORT, APPIUM_PATH } = process.env;
if (PLATFORM) env.platform = PLATFORM;
if (NATIVEPROOF_PROJECT) env.project = NATIVEPROOF_PROJECT;
if (SPEC) env.spec = SPEC;
if (APPIUM_HOST) env.appiumHost = APPIUM_HOST;
if (APPIUM_PORT) env.appiumPort = Number(APPIUM_PORT);
if (APPIUM_PATH) env.appiumPath = APPIUM_PATH;

export const config = buildWdioConfig(userConfig, env);
