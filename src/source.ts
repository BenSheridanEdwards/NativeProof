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
    const m = new RegExp(`${attrPattern(name)}(-?\\d+(?:\\.\\d+)?)"`).exec(node);
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

/**
 * A caller's RegExp with the `g` flag stripped. A `g`-flagged RegExp is stateful across
 * `.test()` calls (`lastIndex` advances after a hit), so polling the same pattern every
 * wait interval alternates match/no-match — `expect(...).not.toShow(/x/g)` falsely passes.
 */
export function deGlobal(pattern: RegExp): RegExp {
  return pattern.global ? new RegExp(pattern.source, pattern.flags.replace("g", "")) : pattern;
}

/**
 * Regex fragment matching `name="` only as a WHOLE attribute name. Without the
 * lookbehind, `clickable=` also matches inside `long-clickable=` (UiAutomator emits it
 * on nearly every node) and `value=` inside iOS `placeholderValue=` — silently reading
 * the wrong attribute. `name` may be an alternation like `(?:text|content-desc)`.
 */
export function attrPattern(name: string): string {
  return `(?<![\\w-])${name}="`;
}

/**
 * The union of every node's bounds — the visible viewport as the page source reports it.
 * Lets the locator compute a swipe vector without a screen-size protocol call. Null when
 * no node exposes usable geometry.
 */
export function sourceExtent(source: string): Bounds | null {
  let extent: Bounds | null = null;
  for (const tag of source.matchAll(/<[^>]*>/g)) {
    const bounds = parseNodeBounds(tag[0]);
    if (!bounds) continue;
    if (!extent) {
      extent = { ...bounds };
      continue;
    }
    extent.x1 = Math.min(extent.x1, bounds.x1);
    extent.y1 = Math.min(extent.y1, bounds.y1);
    extent.x2 = Math.max(extent.x2, bounds.x2);
    extent.y2 = Math.max(extent.y2, bounds.y2);
  }
  if (!extent) return null;
  extent.width = extent.x2 - extent.x1;
  extent.height = extent.y2 - extent.y1;
  extent.centerX = Math.round((extent.x1 + extent.x2) / 2);
  extent.centerY = Math.round((extent.y1 + extent.y2) / 2);
  return extent;
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
 * may be a regex alternation (e.g. `"(?:text|content-desc)"`). Both string and RegExp
 * values are tested against each candidate's DECODED value — so `by.text("I'll speak")`
 * matches whether the source wrote `I&apos;ll`, `I&#39;ll`, or a literal apostrophe,
 * and `by.text(/Save( draft)?/)` matches whether the source XML-escaped it or not.
 */
export function nodeForAttribute(source: string, attribute: string, value: string | RegExp): string | null {
  return nodesForAttribute(source, attribute, value)[0] ?? null;
}

/** Every element tag exposing `attribute` with a value matching `value`, in document order. */
export function nodesForAttribute(source: string, attribute: string, value: string | RegExp): string[] {
  // A string is exact equality on the decoded value — encoding the needle instead would
  // miss escapings the encoder doesn't produce (&apos; vs &#39; vs a literal apostrophe).
  // A `g`-flagged RegExp is stateful across `.test()` calls; use a non-global copy so the
  // per-candidate test is order-independent.
  const test =
    typeof value === "string"
      ? (candidate: string) => candidate === value
      : (candidate: string) => deGlobal(value).test(candidate);
  // `attribute` may be an alternation (e.g. `(?:text|content-desc)`), and a node can carry
  // more than one of them — Android often exposes both `text=""` and `content-desc="…"`. Test
  // the pattern against EVERY matching attribute's value, not just the first: otherwise a label
  // that lives in `content-desc` is missed whenever an empty `text=""` precedes it in the tag.
  const candidates = new RegExp(`${attrPattern(attribute)}([^"]*)"`, "g");
  const nodes: string[] = [];
  for (const tag of source.matchAll(/<[^>]*>/g)) {
    for (const attr of tag[0].matchAll(candidates)) {
      if (test(decodeXmlEntities(attr[1] ?? ""))) {
        nodes.push(tag[0]);
        break;
      }
    }
  }
  return nodes;
}

function attributeValueMatches(node: string, attribute: string, value: string | RegExp): boolean {
  const values = [...node.matchAll(new RegExp(`${attrPattern(attribute)}([^"]*)"`, "g"))].map((match) =>
    decodeXmlEntities(match[1] ?? ""),
  );
  if (typeof value === "string") return values.some((candidate) => candidate === value);
  const test = deGlobal(value);
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

function nodeHasAccessibleName(node: string, platform: "android" | "ios"): boolean {
  return accessibleNameAttributes(platform).some((attribute) =>
    [...node.matchAll(new RegExp(`${attrPattern(attribute)}([^"]*)"`, "g"))].some(
      (match) => decodeXmlEntities(match[1] ?? "").trim().length > 0,
    ),
  );
}

function isIosCheckboxButton(node: string): boolean {
  if (!attributeValueMatches(node, "type", /XCUIElementTypeButton/)) return false;

  const bounds = parseNodeBounds(node);
  if (!bounds) return false;
  const isSmallSquare =
    bounds.width >= 16 &&
    bounds.height >= 16 &&
    bounds.width <= 56 &&
    bounds.height <= 56 &&
    Math.abs(bounds.width - bounds.height) <= 12;
  if (!isSmallSquare) return false;

  return attributeValueMatches(node, "value", /^(?:0|1|selected|unselected|checked|unchecked)$/i);
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
        (nodeAccessibleNameMatches(node, platform, /checkbox/i) || isIosCheckboxButton(node))
      );
    });
  if (name === undefined) return nodes;

  const namedNodes = namedNodesInSource(source, platform, name);
  return nodes.filter(
    (node) =>
      nodeAccessibleNameMatches(node, platform, name) ||
      (!nodeHasAccessibleName(node, platform) && nodeContainsNamedDescendantOrSibling(node, namedNodes)),
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
  const clickable = [...source.matchAll(new RegExp(`<[^>]*${attrPattern("clickable")}true"[^>]*>`, "g"))]
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
