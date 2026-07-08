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

/** Capture a screenshot + redacted source pair under one prefix; returns the source. */
export async function captureState(prefix: string): Promise<string> {
  const source = await browser.getPageSource().catch((err: unknown) => {
    // A failed capture must not look like a clean empty screen in the evidence trail.
    console.warn(`[nativeproof] getPageSource failed during captureState("${prefix}"): ${err}`);
    return "";
  });
  await captureScreenshot(`${prefix}.png`);
  await captureText(`${prefix}.xml`, source);
  return source;
}

/**
 * A filesystem-safe evidence prefix for a failed behaviour — `failure-<describe>-<test>`
 * with runs of non-word characters collapsed to `_` and capped at 120 chars. Used by the
 * runner's built-in on-failure capture so a failing spec leaves a screenshot + source pair
 * named after it, with no per-spec wiring.
 */
export function failureEvidenceName(test: { parent: string; title: string }): string {
  return `failure-${test.parent}-${test.title}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
}
