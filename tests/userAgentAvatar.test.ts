import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AvatarUploadError, USER_AVATAR_CONTRACT, avatarUploader, canUploadAvatar, checkAvatarFile, mockUserAvatarResponse,
  storageAvatar, uploadMyAgentAvatar, type Post,
} from "../src/addons/conversation/api/userAvatar.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const png = (size = 1024, type = "image/png") => new File([new Uint8Array(size)], "a.png", { type });
const side = (width = 512, height = 512) => async () => ({ width, height });
// Same shape the platform runtime http throws (ApiError: server text in message, HTTP status).
const httpError = (status: number, message: string) => Object.assign(new Error(message), { name: "ApiError", code: "", status });

test("contract: user route, admin field name and limits, one mock shape (backend assumed until U8)", () => {
  assert.equal(USER_AVATAR_CONTRACT.method, "POST");
  assert.equal(USER_AVATAR_CONTRACT.path(7), "/api/v1/addons/agent/mine/definitions/7/avatar");
  assert.equal(USER_AVATAR_CONTRACT.field, "file");
  assert.deepEqual([...USER_AVATAR_CONTRACT.types], ["image/png", "image/jpeg"]);
  assert.equal(USER_AVATAR_CONTRACT.maxBytes, 2 << 20);
  assert.equal(USER_AVATAR_CONTRACT.maxSide, 4096);
  assert.equal(USER_AVATAR_CONTRACT.confirmed, false);
  assert.deepEqual(mockUserAvatarResponse("f1"), { fileId: "f1", path: "/api/v1/avatars/f1" });
});

test("button only for agents I created; system and others' agents never get it", () => {
  assert.equal(canUploadAvatar({ owned: true }), true);
  assert.equal(canUploadAvatar({ owned: false }), false);
  assert.equal(canUploadAvatar({}), false, "system agents from /mine carry no owned flag");
  const card = src("addons/conversation/components/AgentCard.vue");
  assert.match(card, /v-if="canUploadAvatar\(agent\)"[^>]*data-testid="agent-card-avatar"/s);
  assert.match(card, /:disabled="uploading"/);
  assert.match(card, /accept="image\/png,image\/jpeg"/);
});

test("local validation rejects wrong type, oversize and out-of-range sides before any request", async () => {
  assert.equal(checkAvatarFile(png()), "");
  assert.equal(checkAvatarFile(png(10, "image/jpeg")), "");
  assert.equal(checkAvatarFile(png(10, "image/gif")), "type");
  assert.equal(checkAvatarFile(png(10, "image/svg+xml")), "type");
  assert.equal(checkAvatarFile(png((2 << 20) + 1)), "size");
  assert.equal(checkAvatarFile(png(2 << 20)), "");
  let calls = 0;
  const post: Post = async () => { calls++; return mockUserAvatarResponse("x"); };
  for (const [file, dims, kind] of [[png(10, "image/gif"), side(), "type"], [png((2 << 20) + 1), side(), "size"],
    [png(), side(4097, 1), "side"], [png(), side(0, 0), "side"]] as const) {
    await assert.rejects(avatarUploader(post, dims, () => {})(3, file), (e: unknown) => e instanceof AvatarUploadError && e.kind === kind);
  }
  assert.equal(calls, 0);
});

test("upload posts multipart 'file' to the user route and returns the storage path", async () => {
  let call: { path: string; body: FormData } | undefined;
  const path = await uploadMyAgentAvatar(async (p, body) => { call = { path: p, body }; return mockUserAvatarResponse("abc"); }, 9, png());
  assert.equal(path, "/api/v1/avatars/abc");
  assert.equal(call!.path, "/api/v1/addons/agent/mine/definitions/9/avatar");
  assert.ok(call!.body.get("file") instanceof File);
  await assert.rejects(uploadMyAgentAvatar(async () => ({ path: "https://evil.example/x.png" }), 9, png()),
    (e: unknown) => e instanceof AvatarUploadError && e.kind === "failed");
});

test("404 (foreign / missing / system) is one fixed 'not found', server text never leaks", async () => {
  const err = await uploadMyAgentAvatar(async () => { throw httpError(404, "agent not found"); }, 9, png()).catch((e) => e);
  assert.ok(err instanceof AvatarUploadError);
  assert.equal(err.kind, "notFound");
  assert.equal(err.message, "");
  assert.match(src("i18n/zh.ts"), /avatarNotFound: "智能体不存在"/);
});

test("other failures surface the server message, not a swallowed generic", async () => {
  const err = await uploadMyAgentAvatar(async () => { throw httpError(400, "file is not a PNG or JPEG image"); }, 9, png()).catch((e) => e);
  assert.equal(err.kind, "failed");
  assert.equal(err.message, "file is not a PNG or JPEG image");
  const net = await uploadMyAgentAvatar(async () => { throw new Error("Network Error"); }, 9, png()).catch((e) => e);
  assert.equal(net.message, "Network Error");
});

test("busy while uploading; a second click during flight sends nothing", async () => {
  const busy: boolean[] = [];
  let calls = 0;
  let release!: () => void;
  const post: Post = () => { calls++; return new Promise((r) => { release = () => r(mockUserAvatarResponse("z")); }); };
  const pick = avatarUploader(post, side(), (b) => busy.push(b));
  const first = pick(4, png());
  const second = await pick(4, png());
  assert.equal(second, null);
  await new Promise((r) => setTimeout(r, 0));
  release();
  assert.equal(await first, "/api/v1/avatars/z");
  assert.equal(calls, 1);
  assert.deepEqual(busy, [true, false]);
  const again = pick(4, png());
  await new Promise((r) => setTimeout(r, 0));
  release();
  assert.equal(await again, "/api/v1/avatars/z", "lock released after settle");
  assert.equal(calls, 2);
});

test("card shows the uploaded storage path via the storage origin; https-only rule still applies", () => {
  assert.equal(storageAvatar("/api/v1/avatars/abc", "https://storage.example.com"), "https://storage.example.com/api/v1/avatars/abc");
  assert.equal(storageAvatar("https://cdn.example.com/a.png", "https://storage.example.com"), "https://cdn.example.com/a.png");
  assert.equal(storageAvatar("/api/v1/avatars/abc", ""), "/api/v1/avatars/abc");
  assert.equal(storageAvatar(undefined, "https://s.example.com"), undefined);
  const list = src("addons/conversation/views/AgentList.vue");
  assert.match(list, /@avatar=/, "list applies the new avatar to the card");
});
