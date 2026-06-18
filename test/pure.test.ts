import assert from "node:assert/strict";
import { test } from "node:test";
import { redactEvidenceText } from "../src/evidence.js";
import { containsLeakedSecret, countMatches, LEAKED_SECRET_PATTERN } from "../src/log.js";
import {
  boundsForContentDesc,
  boundsForText,
  clickableAncestorBoundsForText,
  decodeXmlEntities,
  encodeXmlEntities,
  parseBounds,
  smallestClickableAncestorBounds,
} from "../src/source.js";

/**
 * Self-contained unit coverage for the framework's pure primitives — no device,
 * no app, no WebDriver session. This is the "it works standalone" proof for the
 * source-geometry, evidence-redaction and network-log helpers the higher-level
 * locator / expect / mock layers build on.
 */

test("parseBounds extracts geometry and centre from a uiautomator bounds string", () => {
  const b = parseBounds("[10,20][110,220]");
  assert.ok(b);
  assert.equal(b.width, 100);
  assert.equal(b.height, 200);
  assert.equal(b.centerX, 60);
  assert.equal(b.centerY, 120);
});

test("parseBounds returns null for malformed or missing input", () => {
  assert.equal(parseBounds("not-bounds"), null);
  assert.equal(parseBounds(undefined), null);
  assert.equal(parseBounds(null), null);
});

test("parseBounds handles negative (off-screen / RTL-shifted) coordinates", () => {
  const b = parseBounds("[-10,-5][90,95]");
  assert.ok(b);
  assert.equal(b.x1, -10);
  assert.equal(b.y1, -5);
  assert.equal(b.width, 100);
  assert.equal(b.centerX, 40);
  assert.equal(b.centerY, 45);
});

test("decode/encodeXmlEntities round-trip the page-source escaping", () => {
  assert.equal(decodeXmlEntities("Terms &amp; Conditions &lt;x&gt;"), "Terms & Conditions <x>");
  assert.equal(encodeXmlEntities("Terms & Conditions <x>"), "Terms &amp; Conditions &lt;x&gt;");
  assert.equal(decodeXmlEntities("&amp;lt;"), "&lt;"); // &amp; decoded last, so this is not "<"
});

test("boundsForText matches a label the source XML-escaped (plain string in, entities in source)", () => {
  const source = '<node text="Terms &amp; Conditions" bounds="[0,0][200,80]" />';
  const b = boundsForText(source, "Terms & Conditions");
  assert.ok(b);
  assert.equal(b.centerX, 100);
  assert.equal(b.centerY, 40);
});

test("boundsForAttribute resolves even when bounds precedes the selector attribute", () => {
  // Real dumps don't guarantee bounds comes after text/content-desc.
  const source = '<node bounds="[0,0][200,80]" text="Submit" />';
  const b = boundsForText(source, "Submit");
  assert.ok(b);
  assert.equal(b.centerX, 100);
  assert.equal(b.centerY, 40);
});

test("smallestClickableAncestorBounds resolves when bounds precedes clickable", () => {
  const inner = parseBounds("[50,90][150,110]");
  assert.ok(inner);
  const source =
    '<node bounds="[0,0][300,400]" clickable="true">' +
    '<node text="Tap me" clickable="false" bounds="[50,90][150,110]" /></node>';
  const b = smallestClickableAncestorBounds(source, inner);
  assert.equal(b.x1, 0);
  assert.equal(b.x2, 300);
});

test("boundsForContentDesc locates the element addressed by content-desc", () => {
  const source = '<node content-desc="Sign out" bounds="[0,0][50,50]" />';
  const b = boundsForContentDesc(source, "Sign out");
  assert.ok(b);
  assert.equal(b.centerX, 25);
  assert.equal(b.centerY, 25);
});

test("clickableAncestorBoundsForText returns the smallest clickable container of a text node", () => {
  const source =
    '<node clickable="true" bounds="[0,0][200,200]">' +
    '<node clickable="true" bounds="[10,10][120,60]">' +
    '<node text="Members (3)" bounds="[20,20][100,40]" /></node></node>';
  const b = clickableAncestorBoundsForText(source, "Members (3)");
  assert.ok(b);
  assert.equal(b.x1, 10);
  assert.equal(b.x2, 120);
});

test("countMatches counts non-overlapping occurrences whether or not the pattern is global", () => {
  assert.equal(countMatches("a:1 a:2 a:3", /a:\d/), 3);
  assert.equal(countMatches("a:1 a:2", /a:\d/g), 2);
  assert.equal(countMatches("none here", /a:\d/), 0);
});

test("LEAKED_SECRET_PATTERN is app-agnostic: catches real bearer tokens, ignores fakes and app secrets", () => {
  assert.equal(containsLeakedSecret("Authorization: Bearer ab12.cd34_ef"), true);
  assert.equal(containsLeakedSecret("Bearer fake-e2e-token"), false);
  // An app-specific secret literal (e.g. a passcode) is injected by the consumer,
  // never baked into the framework — so the bare value is not flagged here.
  assert.equal(containsLeakedSecret("passcode 2468"), false);
  assert.equal(LEAKED_SECRET_PATTERN.test("2468"), false);
});

test("redactEvidenceText strips passcodes, 4-8 digit values and bearer tokens", () => {
  assert.match(redactEvidenceText('<node text="2468" />'), /\[REDACTED\]/);
  assert.match(redactEvidenceText("passcode: 246800"), /passcode: \[REDACTED\]/);
  assert.match(redactEvidenceText("Authorization: Bearer abc.def"), /Bearer \[REDACTED\]/);
  assert.doesNotMatch(redactEvidenceText("hello world"), /\[REDACTED\]/);
});
