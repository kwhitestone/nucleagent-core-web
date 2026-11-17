import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageActions, persistedMessageID } from '../src/chat-react/messageActions.ts';

function fixture() {
  const calls: unknown[][] = [];
  let current = true;
  let running = false;
  const actions = createMessageActions({
    isCurrent: () => current, isRunning: () => running,
    list: async () => [{ messageId: 4, rating: -1 as const, reason: 'other', comment: 'saved' }],
    set: async (id, value) => { calls.push(['set', id, value]); return { messageId: id, ...value }; },
    clear: async (id) => { calls.push(['clear', id]); },
    fork: async (id, before, content) => { calls.push(['fork', id, before, content]); return { id: 20 }; },
    send: async (id, content, attachments) => { calls.push(['send', id, content, attachments]); },
    navigate: (id) => { calls.push(['navigate', id]); },
    created: () => { calls.push(['refresh']); },
  });
  return { actions, calls, expire: () => { current = false; }, run: () => { running = true; } };
}

test('feedback restores, switches mutually exclusively, and revokes repeated vote', async () => {
  const { actions, calls } = fixture();
  await actions.load();
  assert.equal(actions.feedback.get(4)?.comment, 'saved');
  await actions.vote(4, 1);
  assert.equal(actions.feedback.get(4)?.rating, 1);
  assert.equal(actions.feedback.get(4)?.comment, '');
  await actions.vote(4, 1);
  assert.equal(actions.feedback.has(4), false);
  assert.equal(calls.at(-1)?.[0], 'clear');
  await actions.vote(4, -1);
  await actions.details(4, 'not_helpful', '  literal detail  ');
  assert.equal(actions.feedback.get(4)?.comment, '  literal detail  ');
});

test('fork keeps pivot; edit save replaces only copied pivot; resend excludes pivot and preserves bytes/attachments', async () => {
  const { actions, calls } = fixture();
  const question = { id: 3, content: '  raw\ntext  ', attachments: [{ fileId: 'f1', name: 'image' }] };
  await actions.branch(question, 'fork');
  assert.deepEqual(calls[0], ['fork', 3, false, undefined]);
  assert.equal(calls.some((call) => call[0] === 'send'), false);
  calls.length = 0;
  await actions.branch(question, 'save', 'edited');
  assert.deepEqual(calls[0], ['fork', 3, false, 'edited']);
  calls.length = 0;
  await actions.branch(question, 'send');
  assert.deepEqual(calls[0], ['fork', 3, true, undefined]);
  assert.deepEqual(calls.find((call) => call[0] === 'send'), ['send', 20, question.content, question.attachments]);
});

test('busy, streaming and stale identity prevent mutations', async () => {
  const { actions, calls, run, expire } = fixture();
  run();
  await actions.vote(4, 1);
  assert.equal(calls.length, 0);
  expire();
  await actions.branch({ id: 3, content: 'x' }, 'fork');
  assert.equal(calls.length, 0);
  assert.equal(persistedMessageID('msg-123'), 123);
  assert.equal(persistedMessageID('optimistic-123'), undefined);
  assert.equal(persistedMessageID('msg-0'), undefined);
});

test('pending mutation is single-flight and failure leaves feedback retryable', async () => {
  let release!: (value?: unknown) => void;
  let count = 0;
  const actions = createMessageActions({ ...fixtureDeps(), set: async () => {
    count++; await new Promise((resolve) => { release = resolve; }); throw new Error('offline');
  } });
  const pending = actions.vote(4, 1);
  await actions.vote(4, -1);
  assert.equal(count, 1);
  release();
  await assert.rejects(pending, /offline/);
  assert.equal(actions.feedback.size, 0);
  assert.equal(actions.busy, false);
});

function fixtureDeps() {
  return { isCurrent: () => true, isRunning: () => false, list: async () => [], clear: async () => {},
    fork: async () => ({ id: 20 }), send: async () => {}, navigate: (_id: number) => {}, created: () => {} };
}

test('unknown send navigates to saved fork and never automatically replays the send', async () => {
  const visited: number[] = [];
  let sends = 0;
  const actions = createMessageActions({ ...fixtureDeps(), set: async () => { throw Error(); },
    send: async () => { sends++; throw Error('unknown'); }, navigate: (id) => { visited.push(id); } });
  await assert.rejects(actions.branch({ id: 3, content: 'x' }, 'send'), /unknown/);
  assert.equal(sends, 1);
  assert.deepEqual(visited, [20]);
});

test('session replacement fences a pending fork before send and navigation', async () => {
  let current = true;
  let release!: (value: { id: number }) => void;
  const effects: string[] = [];
  const actions = createMessageActions({ ...fixtureDeps(), isCurrent: () => current,
    set: async () => { throw Error(); }, fork: () => new Promise((resolve) => { release = resolve; }),
    send: async () => { effects.push('send'); }, navigate: () => { effects.push('navigate'); }, created: () => { effects.push('refresh'); } });
  const pending = actions.branch({ id: 3, content: 'x' }, 'send');
  current = false; release({ id: 20 }); await pending;
  assert.deepEqual(effects, []);
});

test('late feedback load cannot overwrite a newer vote', async () => {
  let release!: (value: { messageId: number; rating: -1; reason: string; comment: string }[]) => void;
  const actions = createMessageActions({ ...fixtureDeps(),
    list: () => new Promise((resolve) => { release = resolve; }),
    set: async (id, value) => ({ messageId: id, ...value }) });
  const loading = actions.load();
  await actions.vote(4, 1);
  release([{ messageId: 4, rating: -1, reason: 'other', comment: 'old' }]); await loading;
  assert.equal(actions.feedback.get(4)?.rating, 1);
});
