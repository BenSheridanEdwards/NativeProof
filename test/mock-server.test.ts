import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import { expect } from "../src/expect.js";
import { startMockServer } from "../src/mock-server.js";

/**
 * The first-party mock server, exercised in-process over real localhost HTTP + WS —
 * no device, no app. Proves frame recording, route() interception (fulfill/reject) and
 * server-initiated push, all readable through the same expect(mock) the specs use.
 */
const FAST = { timeout: 2000, interval: 20 };

function waitOpen(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", reject);
  });
}

/** Resolve with the next message. Attach this BEFORE the message can arrive (e.g. before open). */
function firstMessage(client: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    client.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

/** A keep-alive-free HTTP request so the socket closes promptly and the test process exits. */
function httpRequest(
  url: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const requestBody = options.body ? JSON.stringify(options.body) : undefined;
    const req = request(
      url,
      {
        agent: false,
        method: options.method,
        headers: requestBody
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(requestBody) }
          : {},
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(responseBody) }));
      },
    );
    req.on("error", reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

test("records frames the app sends over a websocket", async () => {
  const server = await startMockServer();
  try {
    const client = new WebSocket(`${server.wsUrl}/messages`);
    await waitOpen(client);
    client.send(JSON.stringify({ type: "connect", roomId: "general" }));
    await expect(server).toHaveSent({ path: "/messages", type: "connect", roomId: "general" }, FAST);
    client.close();
  } finally {
    await server.stop();
  }
});

test("route().fulfill replies to a websocket connect and records it as received", async () => {
  const server = await startMockServer();
  try {
    server.route("/feed").fulfill({ type: "message", text: "hello" });
    const client = new WebSocket(`${server.wsUrl}/feed`);
    const message = firstMessage(client); // attach before open so the connect-reply isn't missed
    await waitOpen(client);
    assert.deepEqual(await message, { type: "message", text: "hello" });
    await expect(server).toHaveReceived({ path: "/feed", type: "message" }, FAST);
    client.close();
  } finally {
    await server.stop();
  }
});

test("route().fulfill replies to an already-connected websocket", async () => {
  const server = await startMockServer();
  try {
    const client = new WebSocket(`${server.wsUrl}/feed`);
    await waitOpen(client);
    const message = firstMessage(client);
    server.route("/feed").fulfill({ type: "message", text: "late" });
    assert.deepEqual(await message, { type: "message", text: "late" });
    await expect(server).toHaveReceived({ path: "/feed", type: "message", text: "late" }, FAST);
    client.close();
  } finally {
    await server.stop();
  }
});

test("send() pushes a server-initiated frame to open sockets and records it once", async () => {
  const server = await startMockServer();
  try {
    assert.throws(
      () => server.send("/messages", { type: "status", code: 0 }),
      /no open WebSocket for this path/,
    );

    const client = new WebSocket(`${server.wsUrl}/messages`);
    const secondClient = new WebSocket(`${server.wsUrl}/messages`);
    await waitOpen(client);
    await waitOpen(secondClient);
    const message = firstMessage(client);
    const secondMessage = firstMessage(secondClient);
    server.send("/messages", { type: "status", code: 0 });
    assert.deepEqual(await message, { type: "status", code: 0 });
    assert.deepEqual(await secondMessage, { type: "status", code: 0 });
    await expect(server).toHaveReceived({ path: "/messages", type: "status", code: 0 }, FAST);
    const received = (await server.frames()).filter(
      (frame) => frame.direction === "received" && frame.path === "/messages" && frame.type === "status",
    );
    assert.equal(received.length, 1);
    client.close();
    secondClient.close();
  } finally {
    await server.stop();
  }
});

test("route().reject closes the websocket connect with the given code", async () => {
  const server = await startMockServer();
  try {
    server.route("/blocked").reject({ code: 4001 });
    const client = new WebSocket(`${server.wsUrl}/blocked`);
    const closeCode = await new Promise<number>((resolve) => {
      client.once("close", (code) => resolve(code));
    });
    assert.equal(closeCode, 4001);
  } finally {
    await server.stop();
  }
});

test("send() after a rejected websocket does not record a false received frame", async () => {
  const server = await startMockServer();
  try {
    server.route("/blocked").reject({ code: 4001 });
    const client = new WebSocket(`${server.wsUrl}/blocked`);
    await new Promise<void>((resolve) => {
      client.once("close", () => resolve());
    });

    assert.throws(() => server.send("/blocked", { type: "ghost" }), /no open WebSocket for this path/);
    await expect(server).not.toHaveReceived(
      { path: "/blocked", type: "ghost" },
      { timeout: 30, interval: 5 },
    );
  } finally {
    await server.stop();
  }
});

test("route().reject closes an already-connected websocket with the given code", async () => {
  const server = await startMockServer();
  try {
    const client = new WebSocket(`${server.wsUrl}/blocked`);
    await waitOpen(client);
    const closeCode = new Promise<number>((resolve) => {
      client.once("close", (code) => resolve(code));
    });
    server.route("/blocked").reject({ code: 4002 });
    assert.equal(await closeCode, 4002);
  } finally {
    await server.stop();
  }
});

test("HTTP route().fulfill answers a REST call; both directions are recorded", async () => {
  const server = await startMockServer();
  try {
    server.route("/api/session").fulfill({ ok: true });
    const response = await httpRequest(`${server.url}/api/session`);
    assert.deepEqual(response.json, { ok: true });
    await expect(server).toHaveSent({ path: "/api/session", type: "request" }, FAST);
    await expect(server).toHaveReceived({ path: "/api/session" }, FAST);
  } finally {
    await server.stop();
  }
});

test("HTTP request bodies are recorded for payload matching", async () => {
  const server = await startMockServer();
  try {
    const response = await httpRequest(`${server.url}/api/signup`, {
      method: "POST",
      body: { email: "a@example.com" },
    });
    assert.deepEqual(response.json, {});
    await expect(server).toHaveSent(
      { path: "/api/signup", type: "request", method: "POST", email: "a@example.com" },
      FAST,
    );
  } finally {
    await server.stop();
  }
});

test("startMockServer rejects (not crashes) when the port is already in use", async () => {
  const first = await startMockServer({ port: 0 });
  try {
    await assert.rejects(
      () => startMockServer({ port: first.port }),
      (error: Error) => {
        assert.match(error.message, /already in use/);
        assert.match(error.message, new RegExp(String(first.port)));
        return true;
      },
    );
  } finally {
    await first.stop();
  }
});
