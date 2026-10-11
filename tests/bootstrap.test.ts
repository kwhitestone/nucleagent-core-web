import assert from "node:assert/strict";
import test from "node:test";
import { startRuntimeApp } from "../src/bootstrap.ts";

test("async initialization retains only bounded public init, not credentials, and replays after mount", async t => {
  const target = new EventTarget() as Window;
  const parent = new MessageChannel().port1;
  t.after(() => parent.close());
  Object.defineProperty(target, "parent", { value: parent });
  let release!: () => void;
  const config = new Promise<void>(resolve => { release = resolve; });
  const delivered: MessageEvent[] = [];
  const pending = startRuntimeApp(() => config, async () => {
    target.addEventListener("message", event => delivered.push(event as MessageEvent));
    send({ type: "agentia:embed-init", payload: { conversationId: "7" } });
    assert.equal(delivered.length, 0, "init arriving during mount is delivered only by replay");
  }, target);
  const send = (data: object, source = parent) => target.dispatchEvent(new MessageEvent("message", {
    data, source, origin: "https://shell.example.test",
  }));
  send({ type: "agentia:embed-credential", payload: { ucToken: "do-not-buffer" } });
  send({ type: "agentia:embed-init", payload: { conversationId: "7", ucToken: "do-not-buffer" } });
  send({ protocol: "prism-fusion/remote", type: "host:init", version: 1,
    appId: "core", instanceId: "fixture-instance-1234", payload: { token: "do-not-buffer" } });
  assert.equal(delivered.length, 0);
  release();
  await pending;
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.map(event => event.origin), ["https://shell.example.test", "https://shell.example.test"]);
  assert.ok(delivered.every(event => event.source === parent));
  assert.doesNotMatch(JSON.stringify(delivered.map(event => event.data)), /do-not-buffer|ucToken/);
});

test("failed config never mounts, replays or retains a listener", async () => {
  let added = 0, removed = 0, mounted = 0, dispatched = 0;
  const target = {
    addEventListener() { added++; }, removeEventListener() { removed++; },
    dispatchEvent() { dispatched++; },
  } as unknown as Window;
  await assert.rejects(startRuntimeApp(async () => { throw Error("invalid config"); },
    async () => { mounted++; }, target));
  assert.deepEqual([added, removed, mounted, dispatched], [1, 1, 0, 0]);
});
