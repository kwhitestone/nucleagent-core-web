/**
 * MUYU-409: structure of PROD conversation 1131 (2026-11-25), read-only capture, desensitized: no signed URLs,
 * file ids, hashes or Toolgate key ids; ids, step ids, states and amounts are kept as Core returned them.
 */
import type { Message } from "../../src/addons/conversation/api/types.ts";

const at = (s: string) => `2026-11-25T11:${s}Z`;
const media = (id: number, kind: "image" | "video", taskId: number, batch: number, created: string): Message => ({
  id, conversationId: 1131, senderType: "agent", senderName: "media", msgType: "result", content: `已为你生成 1 ${kind === "image" ? "张图片" : "段视频"}。`,
  metadata: { media: { kind, batch, count: 1, index: 1, model: kind === "image" ? "doubao-seedream-5-0-flash-260915" : "MiniMax-H3", taskId }, step_id: `media-${taskId}` },
  createdAt: at(created),
} as Message);
const prompt = (id: number, kind: "image" | "video", taskId: number, created: string): Message => ({
  id, conversationId: 1131, senderType: "user", senderName: "user", msgType: "text", content: `prompt-${taskId}`,
  metadata: { media: { kind, count: 1, taskIds: [taskId] } }, createdAt: at(created),
} as Message);

/** Messages 16349–16364 (the media part of 1131), in Core's order. */
export const messages1131: Message[] = [
  prompt(16349, "image", 31, "48:49.358"),
  media(16350, "image", 31, 16349, "48:58.901"),
  prompt(16351, "video", 32, "49:19.753"),
  prompt(16352, "video", 33, "50:03.336"),
  { id: 16353, conversationId: 1131, senderType: "user", senderName: "user", msgType: "text", content: "你好", metadata: {}, createdAt: at("50:18.000") } as Message,
  { id: 16358, conversationId: 1131, senderType: "agent", senderName: "agent", msgType: "result", content: "你好！", metadata: { step_id: "1966a0fe-88f0-4858-ac73-fc288c526447" }, createdAt: at("50:22.000") } as Message,
  prompt(16359, "image", 34, "50:37.100"),
  prompt(16360, "image", 35, "50:39.677"),
  media(16361, "image", 34, 16359, "50:46.180"),
  media(16362, "image", 35, 16360, "50:59.820"),
  media(16363, "video", 32, 16351, "51:42.731"),
  media(16364, "video", 33, 16352, "52:03.466"),
];

const receipt = (taskId: number, credits: string, points: string) => ({ taskId, stepId: `media-${taskId}`, state: "settled", credits, points,
  upstreams: [credits === "6000" ? "everai-yunyi" : "aihub-gateway"], revision: 1795607924532 });
/** GET /api/v1/addons/conversation/1131/settlement `data`, as Core answered (text turns trimmed to the one above). */
export const settlement1131 = {
  pointsName: { "zh-CN": "贝壳", en: "Seashell" }, creditsPerCny: 3000, rate: { creditsAmount: 3000, coinAmount: 100 },
  pointsStatus: "ok", pointsReason: null, rateAgeSeconds: null, unit: "credits", revision: 1795607924532,
  turns: [{ stepId: "1966a0fe-88f0-4858-ac73-fc288c526447", state: "settled", credits: "464", points: "16", upstreams: ["everai-yunyi"], revision: 1795607924532 }],
  mediaTasks: [receipt(31, "360", "12"), receipt(32, "6000", "200"), receipt(33, "6000", "200"), receipt(34, "360", "12"), receipt(35, "360", "12")],
};
