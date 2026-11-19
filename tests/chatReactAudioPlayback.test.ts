import assert from "node:assert/strict";
import { test } from "node:test";
import { readAudioBlob } from "../src/chat-react/audioPlayback.ts";

const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode("RIFF"));
new DataView(wav.buffer).setUint32(4, 40, true);
wav.set(new TextEncoder().encode("WAVEfmt "), 8);
const hash = Buffer.from(await crypto.subtle.digest("SHA-256", wav)).toString("hex");
const file = { id: "owned-file", name: "sample.wav", verified: true, mimeType: "audio/wav", size: 48, sha256: hash };

test("audio playback reads only bounded verified owner storage bytes and verifies the hash", async () => {
  const calls: string[] = [];
  const read = async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return new Response(wav, { headers: { "content-type": "audio/wav" } });
  };
  const resolve = async (id: string) => { assert.equal(id, "owned-file"); return "https://storage.example/file"; };
  assert.equal((await readAudioBlob(file, new AbortController().signal, resolve, read)).size, 48);
  for (const change of [{ verified: false }, { size: 65537 }, { sha256: undefined }, { mimeType: "text/html" }]) {
    await assert.rejects(readAudioBlob({ ...file, ...change }, new AbortController().signal, resolve, read));
  }
  assert.equal(calls.length, 1);
  await assert.rejects(readAudioBlob({ ...file, sha256: "0".repeat(64) }, new AbortController().signal, resolve, read));
  await assert.rejects(readAudioBlob(file, new AbortController().signal, resolve, async () => new Response(new Uint8Array(65537))));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(readAudioBlob(file, aborted.signal, resolve, read));
});
