import { isDeepStrictEqual } from "node:util";

/**
 * Backend mocking that feels like Playwright's `page.route()`.
 *
 * The framework owns the *contract* — observe the frames an app exchanged, and
 * intercept a path to control its reply — while a consuming app injects the concrete
 * backend (a mock WebSocket/REST server). With it, `expect(mock).toHaveSent(...)`
 * replaces hand-rolled log parsing and `mock.route("/x").reject(...)` reads like
 * network interception. The framework imports nothing app-specific.
 */

/** Direction of a frame relative to the app under test. */
export type FrameDirection = "sent" | "received";

/** One observed protocol frame (a REST call or socket message), normalised. */
export interface MockFrame {
  readonly path: string;
  readonly type: string;
  readonly direction: FrameDirection;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** A partial frame to match against: `path` / `type` plus any payload fields. */
export interface FrameMatch {
  path?: string | RegExp;
  type?: string | RegExp;
  [key: string]: unknown;
}

/**
 * Match one field of an observed frame against an expected value: a `RegExp` tests the
 * actual string (so paths with query/suffix match — `toHaveSent({ path: /\/users/ })`),
 * anything else is deep structural equality.
 */
function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof RegExp) return typeof actual === "string" && expected.test(actual);
  return isDeepStrictEqual(actual, expected);
}

/** Controls how an intercepted path replies — the Playwright `Route` equivalent. */
export interface MockRoute {
  /** Answer with a canned frame/body. */
  fulfill(frame: Record<string, unknown>): void;
  /** Reject the connect/request with an error code. */
  reject(options: { code: number }): void;
  /** Drop the connect/request entirely. */
  abort(): void;
}

/**
 * A read-only source of observed frames — the minimum `expect(...)` needs to assert
 * traffic. A full {@link MockBackend} is one, but so is any adapter that produces the
 * frames an app exchanged (e.g. a view over an existing request/socket log), so a mock
 * that predates {@link MockBackend} can be asserted on without implementing `route`/`stop`.
 */
export interface FrameLog {
  /** Every frame observed so far, in order, both directions. */
  frames(): Promise<readonly MockFrame[]>;
}

/**
 * The minimum a mock must provide to drive a {@link defineApp} session: observable frames plus a
 * `stop()` the session calls on teardown. `route()` is intentionally NOT required — a session never
 * routes (only a spec does) — so an app whose mock only observes frames and stops can use
 * `defineApp` without implementing `route`. {@link MockBackend} is the full contract (adds `route`).
 */
export interface SessionMock extends FrameLog {
  /** Release the backend (stop the server, close sockets). */
  stop(): Promise<void>;
}

export interface MockBackend extends SessionMock {
  /** Intercept a path and control its reply. */
  route(path: string): MockRoute;
}

/**
 * True if `frame` satisfies every field of `match`: `path` / `type` at the top level,
 * every other key against the frame's payload.
 */
export function matchesFrame(frame: MockFrame, match: FrameMatch): boolean {
  if (match.path !== undefined && !fieldMatches(frame.path, match.path)) return false;
  if (match.type !== undefined && !fieldMatches(frame.type, match.type)) return false;
  for (const [key, value] of Object.entries(match)) {
    if (key === "path" || key === "type") continue;
    if (!fieldMatches(frame.payload?.[key], value)) return false;
  }
  return true;
}

export function describeMatch(match: FrameMatch): string {
  return JSON.stringify(match, (_key, value) => (value instanceof RegExp ? String(value) : value));
}

/** Single-shot check: does any observed frame match `match` in `direction`? */
export async function frameExists(
  source: FrameLog,
  direction: FrameDirection,
  match: FrameMatch,
): Promise<boolean> {
  const frames = await source.frames();
  return frames.some((frame) => frame.direction === direction && matchesFrame(frame, match));
}
