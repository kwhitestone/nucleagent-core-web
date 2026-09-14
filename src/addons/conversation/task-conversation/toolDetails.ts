export interface ProcessToolSource {
  readonly title?: string;
  readonly domain?: string;
  readonly url?: string;
}

export interface ProcessToolDetails {
  readonly query?: string;
  readonly resultCount?: number;
  readonly sources?: readonly ProcessToolSource[];
  readonly truncated?: boolean;
}

export type PlanStepStatus = "pending" | "inProgress" | "completed";

export interface ProcessPlanStep {
  readonly step: string;
  readonly status: PlanStepStatus;
}

export interface ProcessPlan {
  readonly steps: readonly ProcessPlanStep[];
  readonly explanation?: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.slice(0, limit * 2).trim().slice(0, limit);
  return normalized || undefined;
};

const safeHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  const candidate = value.trim();
  if (!candidate || !/^https?:\/\//i.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizeSource = (value: unknown): ProcessToolSource | undefined => {
  if (!isRecord(value)) return undefined;
  const title = boundedString(value.title, 300);
  const domain = boundedString(value.domain, 253);
  const url = safeHttpUrl(value.url);
  if (!title && !domain && !url) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(domain ? { domain } : {}),
    ...(url ? { url } : {}),
  };
};

/**
 * Copies only the process-detail fields understood by the conversation UI.
 * The returned object never shares mutable arrays or objects with transport
 * metadata, and source links are restricted to explicit HTTP(S) URLs.
 */
export function normalizeProcessToolDetails(
  value: unknown,
): ProcessToolDetails | undefined {
  if (!isRecord(value)) return undefined;
  const rawQuery = typeof value.query === "string" ? value.query : undefined;
  const query = boundedString(rawQuery, 512);
  const resultCount =
    typeof value.resultCount === "number" &&
    Number.isSafeInteger(value.resultCount) &&
    value.resultCount >= 0
      ? value.resultCount
      : undefined;
  const rawSources = Array.isArray(value.sources) ? value.sources : [];
  const sources = rawSources.length
    ? rawSources
        .slice(0, 10)
        .map(normalizeSource)
        .filter((source): source is ProcessToolSource => source !== undefined)
    : [];
  const truncated =
    value.truncated === true ||
    (rawQuery !== undefined && rawQuery.length > 512) ||
    rawSources.length > 10
      ? true
      : value.truncated === false
        ? false
        : undefined;

  if (
    !query &&
    resultCount === undefined &&
    sources.length === 0 &&
    truncated !== true
  ) {
    return undefined;
  }
  return {
    ...(query ? { query } : {}),
    ...(resultCount !== undefined ? { resultCount } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

/**
 * Copies only the structured plan fields understood by the conversation UI.
 * Steps are bounded (count + text length) and statuses whitelisted, mirroring
 * the backend sanitizer. Returns undefined when the value is not a usable plan.
 */
export function normalizeProcessPlan(value: unknown): ProcessPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.steps)) return undefined;
  const steps: ProcessPlanStep[] = [];
  for (const raw of value.steps.slice(0, 32)) {
    if (!isRecord(raw)) continue;
    const step = boundedString(raw.step, 160);
    if (!step) continue;
    const status: PlanStepStatus =
      raw.status === "inProgress" || raw.status === "completed"
        ? raw.status
        : "pending";
    steps.push({ step, status });
  }
  if (steps.length === 0) return undefined;
  const explanation = boundedString(value.explanation, 600);
  return { steps, ...(explanation ? { explanation } : {}) };
}
