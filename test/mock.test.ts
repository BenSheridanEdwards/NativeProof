import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "../src/expect.js";
import type { MockBackend, MockFrame, MockRoute } from "../src/mock.js";

/**
 * Mock interception + expect(mock) coverage, driven by an in-memory fake backend —
 * no server, no sockets. Proves frame matching, direction, negation and route().
 */
class FakeBackend implements MockBackend {
  private readonly recorded: MockFrame[] = [];
  readonly routed: Record<string, string> = {};

  record(frame: MockFrame): void {
    this.recorded.push(frame);
  }

  async frames(): Promise<readonly MockFrame[]> {
    return this.recorded;
  }

  route(path: string): MockRoute {
    return {
      fulfill: (frame) => {
        this.routed[path] = `fulfill:${JSON.stringify(frame)}`;
      },
      reject: (options) => {
        this.routed[path] = `reject:${options.code}`;
      },
      abort: () => {
        this.routed[path] = "abort";
      },
    };
  }

  async stop(): Promise<void> {}
}

test("expect(mock).toHaveSent matches a sent frame by path, type and payload", async () => {
  const mock = new FakeBackend();
  mock.record({ path: "/messages", type: "disconnect", direction: "sent", payload: { end: false } });
  await expect(mock).toHaveSent({ path: "/messages", type: "disconnect", end: false });
});

test("expect(mock) distinguishes sent from received by direction", async () => {
  const mock = new FakeBackend();
  mock.record({ path: "/messages", type: "new", direction: "received" });
  await expect(mock).toHaveReceived({ path: "/messages", type: "new" });
  await expect(mock).not.toHaveSent({ path: "/messages", type: "new" }, { timeout: 30, interval: 5 });
});

test("expect(mock).toHaveSent rejects when no matching frame appears", async () => {
  const mock = new FakeBackend();
  await assert.rejects(
    () => expect(mock).toHaveSent({ type: "disconnect" }, { timeout: 30, interval: 5 }),
    /toHaveSent/,
  );
});

test("a payload mismatch is not a match", async () => {
  const mock = new FakeBackend();
  mock.record({ path: "/messages", type: "disconnect", direction: "sent", payload: { end: true } });
  await expect(mock).not.toHaveSent(
    { path: "/messages", type: "disconnect", end: false },
    { timeout: 30, interval: 5 },
  );
});

test("mock.route records a canned interception for a path (Playwright route().reject)", () => {
  const mock = new FakeBackend();
  mock.route("/messages").reject({ code: 4 });
  assert.equal(mock.routed["/messages"], "reject:4");
});
