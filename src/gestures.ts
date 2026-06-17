import { browser } from "@wdio/globals";

/**
 * Low-level pointer gestures.
 *
 * Compose / SwiftUI surfaces frequently expose accessibility nodes that Appium
 * reports as non-clickable or `visible=false`, so coordinate taps (computed from
 * the page source bounds) are a first-class fallback throughout the app's screen objects.
 * These helpers are app-agnostic and form part of the reusable framework core.
 */

export async function tapAt(x: number, y: number): Promise<void> {
  await browser.performActions([
    {
      type: "pointer",
      id: "finger1",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, x, y },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 100 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

export async function swipe(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  duration = 600,
): Promise<void> {
  await browser.performActions([
    {
      type: "pointer",
      id: "finger1",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, x: fromX, y: fromY },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 100 },
        { type: "pointerMove", duration, x: toX, y: toY },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

export async function pause(ms: number): Promise<void> {
  await browser.pause(ms);
}
