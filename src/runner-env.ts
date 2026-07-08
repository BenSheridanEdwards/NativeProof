import type { RunnerEnv } from "./config.js";

type Warn = (message: string) => void;

interface RunnerEnvOptions {
  platform?: boolean;
  project?: boolean;
  spec?: boolean;
  warn?: Warn;
}

function envValue(
  env: NodeJS.ProcessEnv,
  current: string,
  legacy: string | undefined,
  warn: Warn,
): string | undefined {
  const value = env[current];
  if (value) return value;
  if (legacy && env[legacy]) {
    warn(`nativeproof: ${legacy} is deprecated for runner selection; use ${current} instead`);
    return env[legacy];
  }
  return undefined;
}

export function runnerEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
  options: RunnerEnvOptions = {},
): RunnerEnv {
  const warn = options.warn ?? console.warn;
  const selection: RunnerEnv = {};
  if (options.platform ?? true) {
    const platform = envValue(env, "NATIVEPROOF_PLATFORM", "PLATFORM", warn);
    if (platform) selection.platform = platform;
  }
  if (options.project ?? true) {
    const project = env.NATIVEPROOF_PROJECT;
    if (project) selection.project = project;
  }
  if (options.spec ?? true) {
    const spec = envValue(env, "NATIVEPROOF_SPEC", "SPEC", warn);
    if (spec) selection.spec = spec;
  }
  return selection;
}
