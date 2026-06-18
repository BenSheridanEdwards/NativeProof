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
  path?: string;
  type?: string;
  [key: string]: unknown;
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

export interface MockBackend {
  /** Every frame observed so far, in order, both directions. */
  frames(): Promise<readonly MockFrame[]>;
  /** Intercept a path and control its reply. */
  route(path: string): MockRoute;
  /** Release the backend (stop the server, close sockets). */
  stop(): Promise<void>;
}

/**
 * True if `frame` satisfies every field of `match`: `path` / `type` at the top level,
 * every other key against the frame's payload.
 */
export function matchesFrame(frame: MockFrame, match: FrameMatch): boolean {
  if (match.path !== undefined && frame.path !== match.path) return false;
  if (match.type !== undefined && frame.type !== match.type) return false;
  for (const [key, value] of Object.entries(match)) {
    if (key === "path" || key === "type") continue;
    if (!isDeepStrictEqual(frame.payload?.[key], value)) return false;
  }
  return true;
}

export function describeMatch(match: FrameMatch): string {
  return JSON.stringify(match);
}

/** Single-shot check: does any observed frame match `match` in `direction`? */
export async function frameExists(
  mock: MockBackend,
  direction: FrameDirection,
  match: FrameMatch,
): Promise<boolean> {
  const frames = await mock.frames();
  return frames.some((frame) => frame.direction === direction && matchesFrame(frame, match));
}
