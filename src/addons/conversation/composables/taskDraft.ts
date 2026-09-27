/**
 * 保存草稿 (Q5, desktop only): one task-form draft per browser, local.
 * The button had no handler before; phones drop it (board §12). Launching clears it.
 * ponytail: browser-local, one slot; server-side drafts if users need them across devices.
 */
export const DRAFT_KEY = "nucleagent_task_draft";

export interface TaskDraft {
  name: string;
  desc: string;
  execMode: string;
  outputFormat: string;
  templateName: string;
  skillIds: number[];
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export function saveDraft(storage: Storage, draft: TaskDraft): void {
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

/** Junk or a foreign shape reads as no draft rather than half-filling the form. */
export function readDraft(storage: Storage): TaskDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const draft: TaskDraft = {
    name: text(d.name, 200),
    desc: text(d.desc, 20000),
    execMode: text(d.execMode, 32) || "auto",
    outputFormat: text(d.outputFormat, 32) || "markdown",
    templateName: text(d.templateName, 200),
    skillIds: Array.isArray(d.skillIds) ? d.skillIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [],
  };
  return draft.name || draft.desc ? draft : null;
}

export function clearDraft(storage: Storage): void {
  storage.removeItem(DRAFT_KEY);
}
