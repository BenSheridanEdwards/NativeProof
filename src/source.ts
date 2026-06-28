/**
 * Page-source geometry helpers.
 *
 * Android UiAutomator and iOS XCUITest both expose an XML page source with
 * `bounds="[x1,y1][x2,y2]"` attributes. When semantic selectors are unavailable
 * or unreliable, the screens parse those bounds to compute a tap point. Keeping
 * this parsing in one framework module is what makes the brittle-selector problem
 * a single, replaceable seam rather than scattered regexes.
 */

export type Bounds = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export function parseBounds(bounds: string | undefined | null): Bounds | null {
  const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds ?? "");
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x1,
    y1,
    x2,
    y2,
    width: x2 - x1,
    height: y2 - y1,
    centerX: Math.round((x1 + x2) / 2),
    centerY: Math.round((y1 + y2) / 2),
  };
}

/**
 * Bounds of a single element node, cross-platform. Android UiAutomator exposes geometry as
 * `bounds="[x1,y1][x2,y2]"`; iOS XCUITest exposes separate `x`/`y`/`width`/`height` attributes
 * (no `bounds`). Tries the Android form first, then falls back to the iOS attributes — so locators
 * resolve a tap point on both platforms. Without this, iOS elements have null bounds and `tap()`
 * never finds a target.
 */
export function parseNodeBounds(node: string): Bounds | null {
  const android = parseBounds(/bounds="([^"]+)"/.exec(node)?.[1]);
  if (android) return android;
  const attr = (name: string): number | null => {
    const m = new RegExp(`\\b${name}="(-?\\d+(?:\\.\\d+)?)"`).exec(node);
    return m ? Number(m[1]) : null;
  };
  const x = attr("x");
  const y = attr("y");
  const w = attr("width");
  const h = attr("height");
  if (x === null || y === null || w === null || h === null) return null;
  return {
    x1: Math.round(x),
    y1: Math.round(y),
    x2: Math.round(x + w),
    y2: Math.round(y + h),
    width: Math.round(w),
    height: Math.round(h),
    centerX: Math.round(x + w / 2),
    centerY: Math.round(y + h / 2),
  };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decode the XML entities UiAutomator/XCUITest escape attribute values with
 * (`&amp;` → `&`, `&lt;` → `<`, …). `&amp;` is decoded LAST so `&amp;lt;` round-trips
 * to the literal `&lt;` rather than `<`.
 */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Encode a human-readable value to the entity-escaped form the page source uses, so a
 * selector built from a plain string (`"Terms & Conditions"`) matches the escaped source
 * (`text="Terms &amp; Conditions"`). `&` is encoded first to avoid double-encoding.
 */
export function encodeXmlEntities(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The first element tag exposing `attribute` with a value matching `value`. `attribute`
 * may be a regex alternation (e.g. `"(?:text|content-desc)"`). A string matches the
 * entity-escaped source exactly; a RegExp is tested against each candidate's DECODED
 * value, so `by.text(/Save( draft)?/)` matches whether the source XML-escaped it or not.
 */
export function nodeForAttribute(source: string, attribute: string, value: string | RegExp): string | null {
  return nodesForAttribute(source, attribute, value)[0] ?? null;
}

/** Every element tag exposing `attribute` with a value matching `value`, in document order. */
export function nodesForAttribute(source: string, attribute: string, value: string | RegExp): string[] {
  if (typeof value === "string") {
    const escaped = escapeRegExp(encodeXmlEntities(value));
    return [...source.matchAll(new RegExp(`<[^>]*${attribute}="${escaped}"[^>]*>`, "g"))].map((m) => m[0]);
  }
  // A `g`-flagged RegExp is stateful across `.test()` calls; use a non-global copy so the
  // per-candidate test is order-independent.
  const test = value.global ? new RegExp(value.source, value.flags.replace("g", "")) : value;
  // `attribute` may be an alternation (e.g. `(?:text|content-desc)`), and a node can carry
  // more than one of them — Android often exposes both `text=""` and `content-desc="…"`. Test
  // the pattern against EVERY matching attribute's value, not just the first: otherwise a label
  // that lives in `content-desc` is missed whenever an empty `text=""` precedes it in the tag.
  const candidates = new RegExp(`${attribute}="([^"]*)"`, "g");
  const nodes: string[] = [];
  for (const tag of source.matchAll(/<[^>]*>/g)) {
    for (const attr of tag[0].matchAll(candidates)) {
      if (test.test(decodeXmlEntities(attr[1] ?? ""))) {
        nodes.push(tag[0]);
        break;
      }
    }
  }
  return nodes;
}

function attributeValueMatches(node: string, attribute: string, value: string | RegExp): boolean {
  const values = [...node.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((match) =>
    decodeXmlEntities(match[1] ?? ""),
  );
  if (typeof value === "string") return values.some((candidate) => candidate === value);
  const test = value.global ? new RegExp(value.source, value.flags.replace("g", "")) : value;
  return values.some((candidate) => test.test(candidate));
}

function accessibleNameAttributes(platform: "android" | "ios"): readonly string[] {
  return platform === "ios" ? ["label", "value"] : ["content-desc", "text"];
}

function nodeAccessibleNameMatches(
  node: string,
  platform: "android" | "ios",
  name: string | RegExp,
): boolean {
  return accessibleNameAttributes(platform).some((attribute) => attributeValueMatches(node, attribute, name));
}

const ROLE_LABEL_BOUNDS_TOLERANCE_PX = 2;

function nodeBoundsContain(outer: Bounds, inner: Bounds, tolerancePx = 0): boolean {
  return (
    outer.x1 - tolerancePx <= inner.x1 &&
    outer.x2 + tolerancePx >= inner.x2 &&
    outer.y1 - tolerancePx <= inner.y1 &&
    outer.y2 + tolerancePx >= inner.y2
  );
}

function namedNodesInSource(source: string, platform: "android" | "ios", name: string | RegExp): string[] {
  return [...source.matchAll(/<[^>]*>/g)]
    .map((m) => m[0])
    .filter((node) => nodeAccessibleNameMatches(node, platform, name));
}

// Compose/SwiftUI often expose a control's visible label on a child/sibling node while the native
// role lives on a separate node with the same bounds. Treat an in-bounds label as the control name.
function nodeContainsNamedDescendantOrSibling(node: string, namedNodes: readonly string[]): boolean {
  const nodeBounds = parseNodeBounds(node);
  if (!nodeBounds) return false;

  return namedNodes.some((namedNode) => {
    const namedBounds = parseNodeBounds(namedNode);
    return namedBounds !== null && nodeBoundsContain(nodeBounds, namedBounds, ROLE_LABEL_BOUNDS_TOLERANCE_PX);
  });
}

/**
 * Element classes/types that back a semantic role, per platform — Android exposes a widget
 * `class`, iOS an XCUITest `type`. Matched as a substring, so framework variants
 * (`SwitchCompat`, `MaterialButton`, Compose's `android.widget.CheckBox`) all resolve.
 */
const ROLE_PATTERNS: Record<string, { android: readonly string[]; ios: readonly string[] }> = {
  checkbox: { android: ["CheckBox"], ios: ["XCUIElementTypeSwitch"] },
  switch: { android: ["Switch"], ios: ["XCUIElementTypeSwitch"] },
  button: { android: ["Button"], ios: ["XCUIElementTypeButton"] },
  textfield: { android: ["EditText"], ios: ["XCUIElementTypeTextField"] },
  image: { android: ["ImageView"], ios: ["XCUIElementTypeImage"] },
};

/** Roles `by.role` / `getByRole(role)` can match without a name. */
export const KNOWN_ROLES = Object.keys(ROLE_PATTERNS);

/**
 * Every element whose class (Android) / type (iOS) backs `role`, in document order.
 * Throws on an unknown role, listing the supported set.
 */
export function nodesForRole(
  source: string,
  role: string,
  platform: "android" | "ios",
  name?: string | RegExp,
): string[] {
  const normalizedRole = role.toLowerCase();
  const patterns = ROLE_PATTERNS[normalizedRole];
  if (!patterns) {
    throw new Error(
      `Unknown role "${role}". Known roles: ${KNOWN_ROLES.join(", ")}. Use getByLabel / getByText for arbitrary elements.`,
    );
  }
  const attribute = platform === "ios" ? "type" : "class";
  const rolePatterns = platform === "ios" ? patterns.ios : patterns.android;
  const nodes = [...source.matchAll(/<[^>]*>/g)]
    .map((m) => m[0])
    .filter((node) => {
      const roleAttributeMatches = rolePatterns.some((pattern) =>
        attributeValueMatches(node, attribute, new RegExp(escapeRegExp(pattern))),
      );
      if (roleAttributeMatches) return true;

      return (
        platform === "ios" &&
        normalizedRole === "checkbox" &&
        attributeValueMatches(node, "type", /XCUIElementTypeButton/) &&
        nodeAccessibleNameMatches(node, platform, /checkbox/i)
      );
    });
  if (name === undefined) return nodes;

  const namedNodes = namedNodesInSource(source, platform, name);
  return nodes.filter(
    (node) =>
      nodeAccessibleNameMatches(node, platform, name) ||
      nodeContainsNamedDescendantOrSibling(node, namedNodes),
  );
}

/** True if any element exposes `attribute` with a value matching `value` (string exact or RegExp). */
export function attributeMatches(source: string, attribute: string, value: string | RegExp): boolean {
  return nodeForAttribute(source, attribute, value) !== null;
}

/**
 * Bounds of the first element carrying the given attribute match. The element tag is
 * matched first, then `bounds` is extracted from within it regardless of attribute order —
 * so a source that emits `bounds` before the selector attribute still resolves.
 */
export function boundsForAttribute(source: string, attribute: string, value: string | RegExp): Bounds | null {
  const node = nodeForAttribute(source, attribute, value);
  return node ? parseNodeBounds(node) : null;
}

/** Bounds of an element addressed by Android `content-desc`. */
export function boundsForContentDesc(source: string, contentDesc: string): Bounds | null {
  return boundsForAttribute(source, "content-desc", contentDesc);
}

/** Bounds of an element addressed by visible `text`. */
export function boundsForText(source: string, text: string): Bounds | null {
  return boundsForAttribute(source, "text", text);
}

/**
 * The smallest element flagged `clickable="true"` that fully contains the given
 * bounds, or the bounds themselves if none does — turns a non-clickable Compose node
 * into a reliable tap target (e.g. the "Members (3)" list rows).
 */
export function smallestClickableAncestorNode(source: string, nodeBounds: Bounds): string | null {
  const clickable = [...source.matchAll(/<[^>]*clickable="true"[^>]*>/g)]
    .map((m) => ({ node: m[0], bounds: parseNodeBounds(m[0]) }))
    .filter((entry): entry is { node: string; bounds: Bounds } => entry.bounds !== null)
    .filter(
      ({ bounds }) =>
        bounds.x1 <= nodeBounds.x1 &&
        bounds.x2 >= nodeBounds.x2 &&
        bounds.y1 <= nodeBounds.y1 &&
        bounds.y2 >= nodeBounds.y2,
    )
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  return clickable[0]?.node ?? null;
}

export function smallestClickableAncestorBounds(source: string, nodeBounds: Bounds): Bounds {
  const ancestor = smallestClickableAncestorNode(source, nodeBounds);
  return ancestor ? (parseNodeBounds(ancestor) ?? nodeBounds) : nodeBounds;
}

/** The smallest clickable ancestor that fully contains the node with the given visible text. */
export function clickableAncestorBoundsForText(source: string, text: string): Bounds | null {
  const textBounds = boundsForText(source, text);
  return textBounds ? smallestClickableAncestorBounds(source, textBounds) : null;
}
