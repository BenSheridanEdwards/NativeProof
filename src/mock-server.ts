import { createServer, type Server } from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import type { FrameDirection, MockBackend, MockFrame, MockRoute } from "./mock.js";

/**
 * A first-party HTTP + WebSocket mock server implementing {@link MockBackend} natively.
 *
 * Point the app under test at {@link MockServer.url} / {@link MockServer.wsUrl}; the
 * server records every exchanged frame (`frames()`), lets a test control replies per
 * path (`route(path).fulfill/reject/abort`, like Playwright's `page.route()`), and push
 * server-initiated frames (`send()`). This removes the per-app mock adapter: `route()`
 * and the traffic assertions are backed by a real server the framework owns.
 *
 * Synthetic frame types: a websocket open is recorded as `type: "open"`, an HTTP call as
 * `type: "request"`; real protocol messages keep their own `payload.type`.
 */

type RouteAction =
  | { kind: "fulfill"; frame: Record<string, unknown> }
  | { kind: "reject"; code: number }
  | { kind: "abort" };

export interface MockServerOptions {
  /** Port to listen on; 0 (the default) picks a free ephemeral port. */
  port?: number;
  /** Interface to bind; default 127.0.0.1. Use 0.0.0.0 to reach it from an emulator. */
  host?: string;
}

export interface MockServer extends MockBackend {
  /** HTTP base URL the app points at, e.g. `http://127.0.0.1:18113`. */
  readonly url: string;
  /** WebSocket base URL, e.g. `ws://127.0.0.1:18113`. */
  readonly wsUrl: string;
  readonly port: number;
  /** Push a server-initiated frame to every socket open on `path` (recorded as received). */
  send(path: string, frame: Record<string, unknown>): void;
}

function pathOf(rawUrl: string | undefined): string {
  const url = rawUrl ?? "/";
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

function frameType(frame: Record<string, unknown>, fallback: string): string {
  return typeof frame.type === "string" ? frame.type : fallback;
}

/** Valid WebSocket application close codes are 3000-4999; anything else falls back to 4000. */
function wsCloseCode(code: number): number {
  return code >= 3000 && code <= 4999 ? code : 4000;
}

export async function startMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const host = options.host ?? "127.0.0.1";
  const recorded: MockFrame[] = [];
  const routes = new Map<string, RouteAction>();
  const sockets = new Set<{ socket: WebSocket; path: string }>();

  const record = (
    path: string,
    direction: FrameDirection,
    type: string,
    payload: Record<string, unknown>,
  ): void => {
    recorded.push({ path, type, direction, payload });
  };

  const applySocketAction = (entry: { socket: WebSocket; path: string }, action: RouteAction): void => {
    if (action.kind === "reject") {
      entry.socket.close(wsCloseCode(action.code), String(action.code));
      return;
    }
    if (action.kind === "abort") {
      entry.socket.terminate();
      return;
    }
    record(entry.path, "received", frameType(action.frame, "message"), action.frame);
    entry.socket.send(JSON.stringify(action.frame));
  };

  const routeSocketAction = (path: string, action: RouteAction): void => {
    routes.set(path, action);
    for (const entry of sockets) {
      if (entry.path === path) applySocketAction(entry, action);
    }
  };

  const http: Server = createServer((req, res) => {
    const path = pathOf(req.url);
    record(path, "sent", "request", { method: req.method ?? "GET" });
    const action = routes.get(path);
    if (action?.kind === "reject") {
      res.statusCode = action.code;
      res.end();
      return;
    }
    if (action?.kind === "abort") {
      req.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (action?.kind === "fulfill") {
      record(path, "received", frameType(action.frame, "response"), action.frame);
      res.end(JSON.stringify(action.frame));
      return;
    }
    res.end("{}");
  });

  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket, req) => {
    const path = pathOf(req.url);
    const entry = { socket, path };
    sockets.add(entry);
    record(path, "sent", "open", {});

    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = { raw: data.toString() };
      }
      const payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      record(path, "sent", frameType(payload, "message"), payload);
    });
    socket.on("close", () => {
      sockets.delete(entry);
    });

    const action = routes.get(path);
    if (action) applySocketAction(entry, action);
  });

  await new Promise<void>((resolve, reject) => {
    // Without an error listener a busy port emits an unhandled 'error' event and
    // hard-crashes the process (no teardown, nothing catchable) — and the ws server
    // RE-emits http errors on itself, so both emitters need a handler. Reject instead,
    // with the fix a fixture author needs.
    wss.on("error", () => {
      /* surfaced via the http 'error' handler below */
    });
    const onError = (error: NodeJS.ErrnoException) => {
      http.close();
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `startMockServer: port ${options.port} on ${host} is already in use — stop the other process or pass a different port (omit it to pick a free one)`,
              { cause: error },
            )
          : error,
      );
    };
    http.once("error", onError);
    http.listen(options.port ?? 0, host, () => {
      http.removeListener("error", onError);
      resolve();
    });
  });
  const address = http.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);

  return {
    url: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}`,
    port,
    async frames(): Promise<readonly MockFrame[]> {
      return recorded.slice();
    },
    route(path: string): MockRoute {
      return {
        fulfill: (frame) => {
          routeSocketAction(path, { kind: "fulfill", frame });
        },
        reject: (opts) => {
          routeSocketAction(path, { kind: "reject", code: opts.code });
        },
        abort: () => {
          routeSocketAction(path, { kind: "abort" });
        },
      };
    },
    send(path: string, frame: Record<string, unknown>): void {
      for (const entry of sockets) {
        if (entry.path === path) {
          record(path, "received", frameType(frame, "message"), frame);
          entry.socket.send(JSON.stringify(frame));
        }
      }
    },
    async stop(): Promise<void> {
      for (const entry of sockets) entry.socket.terminate();
      wss.close();
      // Drop any lingering keep-alive sockets so http.close() actually resolves.
      http.closeAllConnections();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    },
  };
}
