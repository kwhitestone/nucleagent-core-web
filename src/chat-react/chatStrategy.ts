import { z } from "zod";
import type { ModelChoice } from "../addons/conversation/api/types.ts";
import type { TypedModel } from "../contracts/model-catalog.ts";

const choiceSchema = z.object({ providerId: z.number().int().positive(), model: z.string().min(1) });
const sampleSchema = z.object({ n: z.number().int().nonnegative(), medianMs: z.number().nonnegative(), source: z.string().min(1) });
const strategySchema = z.object({
  scope: z.literal("test-react-ordinary"),
  origin: z.url(),
  backend: z.string().min(1),
  candidate: choiceSchema,
  measurements: z.array(choiceSchema.extend({
    n: z.number().int().nonnegative(), medianMs: z.number().nonnegative(), maxMs: z.number().nonnegative(),
    date: z.iso.date(), versions: z.string().min(1), quality: z.string().min(1),
    thinking: z.object({ supported: z.boolean(), source: z.string().min(1) }).nullable(),
    vision: sampleSchema.nullable(),
  })).max(200),
});
export type ChatStrategy = z.infer<typeof strategySchema>;

export function parseChatStrategy(value: unknown, origin: string): ChatStrategy | null {
  const parsed = strategySchema.safeParse(value);
  return parsed.success && parsed.data.origin === origin ? parsed.data : null;
}

export async function loadChatStrategy(origin: string, fetcher: typeof fetch = fetch): Promise<ChatStrategy | null> {
  try {
    const response = await fetcher(`${origin}/chat-strategy.json`, {
      credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2000),
    });
    return response.ok ? parseChatStrategy(await response.json(), origin) : null;
  } catch { return null; }
}

const same = (left: ModelChoice, right: ModelChoice) => left.providerId === right.providerId && left.model === right.model;
const evidenceFor = (strategy: ChatStrategy | null, model: ModelChoice | null) => model ? strategy?.measurements.find((entry) => same(entry, model)) : undefined;
const qualifies = (sample: { n: number; medianMs: number } | undefined) => !!sample && sample.n >= 5 && sample.medianMs <= 2000;

export function initialChatModel(input: {
  strategy: ChatStrategy | null; conversationId?: string; selected: ModelChoice | null; explicit: boolean;
  backend: string | null; models: TypedModel[]; allowed: (model: ModelChoice) => boolean;
}): ModelChoice | null {
  const { strategy, selected } = input;
  if (selected || input.explicit || input.conversationId || !strategy || input.backend !== strategy.backend) return selected;
  const candidate = strategy.candidate;
  return input.models.some((model) => model.type === "chat" && same(model, candidate))
    && qualifies(evidenceFor(strategy, candidate)) && input.allowed(candidate) ? candidate : selected;
}

export function measurementHint(strategy: ChatStrategy | null, model: ModelChoice): string {
  const sample = evidenceFor(strategy, model);
  if (!sample) return "本批文字 n=0，延迟未知；测量版本/日期未知；思考能力未知";
  const thinking = sample.thinking ? `思考能力${sample.thinking.supported ? "支持" : "不支持"}（${sample.thinking.source}）` : "思考能力未知";
  return `文字 n=${sample.n}，p50 ${sample.medianMs}ms，max ${sample.maxMs}ms；${qualifies(sample) ? "文字p50≤2秒，并非每次≤2秒" : "未达标或样本不足"}；${sample.date} · ${sample.versions}；${thinking}；质量依据：${sample.quality}${strategy && same(strategy.candidate, model) ? "；仅当前已测集合的临时推荐，非全目录最优" : ""}`;
}

export function imageGuidance(strategy: ChatStrategy | null, selected: ModelChoice | null, models: TypedModel[]): string {
  const enabled = (choice: ModelChoice) => models.some((entry) => same(entry, choice) && entry.capabilities.includes("vision_in"));
  const selectedEnabled = !!selected && enabled(selected);
  const sample = evidenceFor(strategy, selectedEnabled ? selected : strategy?.candidate ?? null);
  const vision = sample?.vision;
  const timing = vision ? ` ${sample.model} 视觉 n=${vision.n}，p50 ${vision.medianMs}ms${qualifies(vision) ? "（并非每次≤2秒）" : "，未达2秒或样本不足"}；${sample.date} · ${sample.versions}。` : " 视觉延迟未知。";
  if (selectedEnabled) return `目录已启用图片输入。${timing}`;
  const suggestion = strategy && enabled(strategy.candidate) && evidenceFor(strategy, strategy.candidate)?.vision;
  return `当前模型图片输入能力未知或未启用目录 vision_in，请先选择支持图片的模型。${suggestion ? `可切换至 ${strategy.candidate.model}（需手动选择）。` : "请联系管理员确认图片能力；实测通过不等于当前已启用。"}${timing}`;
}
