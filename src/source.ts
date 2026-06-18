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
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds ?? "");
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bounds of the first element whose `bounds` follows the given attribute match. */
export function boundsForAttribute(source: string, attribute: string, value: string): Bounds | null {
  const match = new RegExp(`${attribute}="${escapeRegExp(value)}"[^>]*bounds="([^"]+)"`).exec(source);
  return match ? parseBounds(match[1]) : null;
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
  const clickable = [...source.matchAll(/clickable="true"[^>]*bounds="([^"]+)"/g)]
    .map((m) => parseBounds(m[1]))
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
