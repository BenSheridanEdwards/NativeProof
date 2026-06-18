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
  const candidate = new RegExp(`${attribute}="([^"]*)"`);
  const nodes: string[] = [];
  for (const tag of source.matchAll(/<[^>]*>/g)) {
    const attr = candidate.exec(tag[0]);
    if (attr && test.test(decodeXmlEntities(attr[1] ?? ""))) nodes.push(tag[0]);
  }
  return nodes;
}

/**
 * Element classes/types that back a semantic role, per platform — Android exposes a widget
 * `class`, iOS an XCUITest `type`. Matched as a substring, so framework variants
 * (`SwitchCompat`, `MaterialButton`, Compose's `android.widget.CheckBox`) all resolve.
 */
const ROLE_PATTERNS: Record<string, { android: string; ios: string }> = {
  checkbox: { android: "CheckBox", ios: "XCUIElementTypeSwitch" },
  switch: { android: "Switch", ios: "XCUIElementTypeSwitch" },
  button: { android: "Button", ios: "XCUIElementTypeButton" },
  textfield: { android: "EditText", ios: "XCUIElementTypeTextField" },
  image: { android: "ImageView", ios: "XCUIElementTypeImage" },
};

/** Roles `by.role` / `getByRole(role)` can match without a name. */
export const KNOWN_ROLES = Object.keys(ROLE_PATTERNS);

/**
 * Every element whose class (Android) / type (iOS) backs `role`, in document order.
 * Throws on an unknown role, listing the supported set.
 */
export function nodesForRole(source: string, role: string, platform: "android" | "ios"): string[] {
  const patterns = ROLE_PATTERNS[role.toLowerCase()];
  if (!patterns) {
    throw new Error(
      `Unknown role "${role}". Known roles: ${KNOWN_ROLES.join(", ")}. Use getByLabel / getByText for arbitrary elements.`,
    );
  }
  const attribute = platform === "ios" ? "type" : "class";
  const pattern = escapeRegExp(platform === "ios" ? patterns.ios : patterns.android);
  return [...source.matchAll(new RegExp(`<[^>]*${attribute}="[^"]*${pattern}[^"]*"[^>]*>`, "g"))].map(
    (m) => m[0],
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
  return node ? parseBounds(/bounds="([^"]+)"/.exec(node)?.[1]) : null;
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
export function smallestClickableAncestorBounds(source: string, nodeBounds: Bounds): Bounds {
  const clickable = [...source.matchAll(/<[^>]*clickable="true"[^>]*>/g)]
    .map((m) => parseBounds(/bounds="([^"]+)"/.exec(m[0])?.[1]))
    .filter((b): b is Bounds => b !== null)
    .filter(
      (b) => b.x1 <= nodeBounds.x1 && b.x2 >= nodeBounds.x2 && b.y1 <= nodeBounds.y1 && b.y2 >= nodeBounds.y2,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return clickable[0] ?? nodeBounds;
}

/** The smallest clickable ancestor that fully contains the node with the given visible text. */
export function clickableAncestorBoundsForText(source: string, text: string): Bounds | null {
  const textBounds = boundsForText(source, text);
  return textBounds ? smallestClickableAncestorBounds(source, textBounds) : null;
}
