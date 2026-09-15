import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";

/**
 * Test-time evidence capture: screenshots and redacted page-source snapshots.
 *
 * A passing mobile test must prove app state, not just "the runner did not throw".
 * Every meaningful step writes a `.png` + redacted `.xml` pair into the artifact
 * directory so a green run is auditable. Common secrets are stripped before anything
 * touches disk. Part of the reusable framework core.
 */

const DEFAULT_ARTIFACT_DIR = ".e2e-artifacts";
let artifactDir = DEFAULT_ARTIFACT_DIR;

/** Configure where evidence files are written. The CLI sets this from nativeproof.config.ts. */
export function setArtifactDir(dir: string | undefined): void {
  artifactDir = dir?.trim() ? dir : DEFAULT_ARTIFACT_DIR;
}

const SENSITIVE_FIELD_HINT =
  /\b(?:password|secure)=["']?true["']?|\b(?:resource-id|id|name|label|content-desc|class)=["'][^"']*(?:password|passcode|secret|token|api[-_ ]?key|session|cookie|authorization|oauth|secure)[^"']*["']/i;
const SENSITIVE_KEY_VALUE =
  /\b(password|passcode|secret|api[-_ ]?key|apikey|x-api-key|session(?:id)?|cookie|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]?token|token)(["']?\s*[:=]\s*["']?)([^"'\s&<>;,]+)/gi;

function redactSensitiveFieldValues(contents: string): string {
  return contents.replace(/<[^>]+>/g, (tag) => {
    if (!SENSITIVE_FIELD_HINT.test(tag)) return tag;
    return tag.replace(/\b(text|value)=(["'])(.*?)\2/gi, (_match, name: string, quote: string) => {
      return `${name}=${quote}[REDACTED]${quote}`;
    });
  });
}

export function redactEvidenceText(contents: string): string {
  return redactSensitiveFieldValues(String(contents))
    .replace(/(text=")\d{4,8}(")/g, "$1[REDACTED]$2")
    .replace(/(passcode"?\s*[:=]\s*"?)\d{4,8}/gi, "$1[REDACTED]")
    .replace(/\b((?:Set-Cookie|Cookie)\s*:\s*)[^\n\r<]+/gi, "$1[REDACTED]")
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^"'\s&<>;,]+(?:\s+[^"'\s&<>;,]+)?/gi, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]")
    .replace(SENSITIVE_KEY_VALUE, (match, key: string, prefix: string, value: string) => {
      return /^(?:true|false|null)$/i.test(value) ? match : `${key}${prefix}[REDACTED]`;
    });
}

async function ensureArtifactDir(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
}

export async function captureText(filename: string, contents: string): Promise<string> {
  await ensureArtifactDir();
  const target = path.join(artifactDir, filename);
  await fs.writeFile(target, redactEvidenceText(contents), "utf8");
  return target;
}

export async function captureScreenshot(filename: string): Promise<string> {
  await ensureArtifactDir();
  const target = path.join(artifactDir, filename);
  await browser.saveScreenshot(target);
  return target;
}

export interface CapturedStatePaths {
  pngPath: string;
  xmlPath: string;
}

interface CaptureStateDependencies {
  getPageSource(): Promise<string>;
  captureScreenshot(filename: string): Promise<string>;
  captureText(filename: string, contents: string): Promise<string>;
}

const defaultCaptureStateDependencies: CaptureStateDependencies = {
  getPageSource: () => browser.getPageSource(),
  captureScreenshot,
  captureText,
};

/** @internal Capture a screenshot + redacted source pair and return only paths written successfully. */
export async function captureStatePaths(
  prefix: string,
  dependencies: CaptureStateDependencies = defaultCaptureStateDependencies,
): Promise<CapturedStatePaths & { source: string }> {
  // Reject the whole pair when source capture fails: an empty XML file would make a partial
  // capture look complete to structured evidence consumers. composeAfterTest keeps this
  // best-effort and preserves the original test failure + consumer hook invocation.
  const source = await dependencies.getPageSource();
  const pngPath = await dependencies.captureScreenshot(`${prefix}.png`);
  const xmlPath = await dependencies.captureText(`${prefix}.xml`, source);
  return { source, pngPath, xmlPath };
}

/** Capture a screenshot + redacted source pair under one prefix; returns the source. */
export async function captureState(prefix: string): Promise<string> {
  return (await captureStatePaths(prefix)).source;
}

/**
 * A filesystem-safe evidence prefix for a failed behaviour — `failure-<describe>-<test>`
 * with runs of non-word characters collapsed to `_`, a full stable digest to avoid
 * truncation collisions, and capped at 120 chars. Used by the runner's built-in on-failure
 * capture so a failing spec leaves a screenshot + source pair with no per-spec wiring.
 */
export function failureEvidenceName(test: {
  parent: string;
  title: string;
  project?: string;
  file?: string;
  fullName?: string;
  attempt?: number;
}): string {
  const raw = `failure-${test.parent}-${test.title}`;
  const identity = [
    test.project ?? "",
    test.file ?? "",
    test.fullName ?? "",
    String(test.attempt ?? 0),
    test.parent,
    test.title,
  ].join("\0");
  const suffix = `-${createHash("sha256").update(identity).digest("hex")}`;
  return `${raw.replace(/[^\w.-]+/g, "_").slice(0, 120 - suffix.length)}${suffix}`;
}
