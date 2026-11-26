import type { EmbedStartRequest } from "./useEmbedHostHandshake.ts";
import { defaultMediaModel, type MediaModel } from "../addons/conversation/composables/generation.ts";
import { createGenChat, type HomeGenDeps } from "../addons/conversation/composables/homeGen.ts";
import { defaultParams } from "../addons/conversation/registry.ts";

export interface EmbedConversationDeps {
  create(body: { mode: "a2a_agent"; input: string }): Promise<{ id: number }>;
  models(kind: "image" | "video"): Promise<MediaModel[]>;
  generate: HomeGenDeps["create"];
  push(to: { path: string; query?: { gen: "image" | "video" } }): Promise<unknown>;
}

function numericId(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("START_FAILED");
  return String(value);
}

export async function startEmbedConversation(deps: EmbedConversationDeps, request: EmbedStartRequest, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!request.gen) {
    const created = await deps.create({ mode: "a2a_agent", input: request.input });
    const id = numericId(created.id);
    signal?.throwIfAborted();
    await deps.push({ path: `/c/${id}` });
    return id;
  }
  const models = await deps.models(request.gen);
  signal?.throwIfAborted();
  const choice = defaultMediaModel(models, request.gen);
  const model = models.find((candidate) => candidate.kind === request.gen && candidate.providerId === choice?.providerId && candidate.model === choice.model);
  if (!model) throw new Error("START_FAILED");
  let id = "";
  await createGenChat({
    create: async (body) => {
      const created = await deps.generate(body);
      signal?.throwIfAborted();
      id = numericId(created.conversationId);
      return created;
    },
    push: deps.push,
    confirm: async () => true,
    ls: { getItem: () => null, setItem: () => undefined },
  }, request.gen, model, request.input, defaultParams(request.gen));
  return id;
}
