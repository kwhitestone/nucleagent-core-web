export interface Feedback { messageId: number; rating: 1 | -1; reason: string; comment: string }
export interface Question { id: number; content: string; attachments?: { fileId: string; name?: string }[] }
export type BranchMode = 'fork' | 'save' | 'send';
interface Dependencies<Branch> {
  isCurrent(): boolean;
  isRunning(): boolean;
  list(): Promise<Feedback[]>;
  set(id: number, value: Omit<Feedback, 'messageId'>): Promise<Feedback>;
  clear(id: number): Promise<void>;
  fork(id: number, before: boolean, content?: string): Promise<Branch>;
  send(id: number, content: string, attachments?: Question['attachments']): Promise<unknown>;
  navigate(id: number): void;
  created(branch: Branch): void;
}

export function persistedMessageID(id: string): number | undefined {
  const value = /^msg-([1-9]\d*)$/.exec(id)?.[1];
  return value && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

export function createMessageActions<Branch extends { id: number }>(deps: Dependencies<Branch>, changed: () => void = () => {}) {
  const feedback = new Map<number, Feedback>();
  let busy = false;
  let revision = 0;
  let loaded = false;
  async function mutate(work: () => Promise<void>) {
    if (busy || deps.isRunning() || !deps.isCurrent()) return;
    busy = true; revision++; changed();
    try { await work(); } finally { busy = false; if (deps.isCurrent()) changed(); }
  }
  async function set(id: number, value: Omit<Feedback, 'messageId'>) {
    const saved = await deps.set(id, value);
    if (deps.isCurrent()) feedback.set(id, saved);
  }
  return {
    feedback,
    isCurrent: deps.isCurrent,
    get loaded() { return loaded; },
    get busy() { return busy; },
    async load() {
      const started = revision;
      const values = await deps.list();
      if (!deps.isCurrent() || revision !== started) return;
      feedback.clear(); values.forEach((value) => feedback.set(value.messageId, value)); loaded = true; changed();
    },
    vote: (id: number, rating: 1 | -1) => mutate(async () => {
      if (feedback.get(id)?.rating === rating) {
        await deps.clear(id); if (deps.isCurrent()) feedback.delete(id);
      } else await set(id, { rating, reason: '', comment: '' });
    }),
    details: (id: number, reason: string, comment: string) => mutate(async () => {
      if (feedback.get(id)?.rating === -1) await set(id, { rating: -1, reason, comment });
    }),
    branch: (question: Question, mode: BranchMode, edited?: string) => mutate(async () => {
      const content = edited ?? question.content;
      if (mode !== 'fork' && !content.trim() && !question.attachments?.length) return;
      const fork = await deps.fork(question.id, mode === 'send', mode === 'save' ? content : undefined);
      if (!deps.isCurrent()) return;
      deps.created(fork);
      try { if (mode === 'send') await deps.send(fork.id, content, question.attachments); }
      finally { if (deps.isCurrent()) deps.navigate(fork.id); }
    }),
  };
}
