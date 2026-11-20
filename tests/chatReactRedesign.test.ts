import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type ViteDevServer } from 'vite';
import { JSDOM } from 'jsdom';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';
import type { ConversationItem } from '../src/addons/conversation/task-conversation/core/types.ts';
import { ZH_STRINGS } from '../src/chat-react/islandStringsZh.ts';

// MUYU-365 exp84: OpenWebUI-reference redesign (DESIGN-SPEC.md). One content column, light user bubble,
// flat one-line process/thinking folds, quiet composer, five motion kinds only, reduced-motion respected.
let vite: ViteDevServer;
let app: typeof import('../src/chat-react/ChatApp.tsx');
let projection: typeof import('../src/chat-react/threadMessages.ts');
let reducer: typeof import('../src/addons/conversation/task-conversation/core/reducer.ts');
let React: typeof import('react');
let aui: typeof import('@assistant-ui/react');
let renderToString: typeof import('react-dom/server').renderToString;
let Viewport: import('react').ElementType;
let unregister: () => void;
let admin = false;
before(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new JSDOM('').window });
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule('/src/contracts/platform-runtime.ts');
  unregister = registerPlatformRuntime({ useEmbeddedAuthorization: () => ({ can: () => admin }) });
  app = await vite.ssrLoadModule('/src/chat-react/ChatApp.tsx');
  Viewport = (await vite.ssrLoadModule('/src/chat-react/auiPrimitives.ts')).ThreadPrimitive.Viewport;
  projection = await vite.ssrLoadModule('/src/chat-react/threadMessages.ts');
  reducer = await vite.ssrLoadModule('/src/addons/conversation/task-conversation/core/reducer.ts');
  React = await import('react');
  aui = await import('@assistant-ui/react');
  ({ renderToString } = await import('react-dom/server'));
});
after(async () => { unregister(); await vite.close(); });

const css = () => readFileSync('src/chat-react/chat.css', 'utf8');
/** All top-level rules for exactly `selector`, joined (a selector may be declared in more than one block). */
const rule = (source: string, selector: string) => {
  const blocks: string[] = [];
  for (let at = `\n${source}`.indexOf(`\n${selector} {`); at >= 0; at = `\n${source}`.indexOf(`\n${selector} {`, at + 1)) blocks.push(source.slice(at, source.indexOf('}', at) + 1));
  assert.ok(blocks.length, `missing rule ${selector}`);
  return blocks.join('\n');
};
const item = (id: string, changes: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: 'main', streamId: id, lane: 'answer', role: 'assistant', kind: 'text', content: '',
  status: 'complete', revision: 1, seq: 1, timestamp: '2026-11-19T15:01:06Z', userReadable: true, ...changes,
});
const call = (id: string, status: ConversationItem['status'] = 'complete', failed = false) => item(id, {
  lane: 'process', kind: 'tool_call', title: '命令执行', status: failed ? 'failed' : status, content: failed ? 'exit 1: game.js not found' : 'PASS desktop 1280 · PASS mobile 390',
  data: { toolCallId: id, toolStatus: failed ? 'failed' : 'completed', durationMs: 10, messageId: 100 + Number(id.replace(/\D/g, '') || 0) },
});
const zh = (key: string) => key.startsWith('chatReact.') ? ZH_STRINGS[key.slice(10) as keyof typeof ZH_STRINGS] ?? key
  : ({ 'home.greeting': 'NucleAgent', 'conversation.you': '你', 'common.copy': '复制' } as Record<string, string>)[key] ?? key;
/** The screenshot scene: one user turn, an assistant turn with N real calls, authorised thinking, an answer and a file. */
export function scene(calls: number, status: 'running' | 'completed' = 'completed') {
  const running = status === 'running';
  return [
    item('u1', { role: 'user', content: '我需要单页的' }),
    ...Array.from({ length: calls }, (_, i) => call(`c${i + 1}`, running && i === calls - 1 ? 'streaming' : 'complete', i === 2)),
    item('thought', { lane: 'process', status: running ? 'streaming' : 'complete', content: '用户需要单页版本：把 game.js 与样式内联到同一个 HTML。', data: { modelThinking: true } }),
    item('answer', { status: running ? 'streaming' : 'complete', content: '明白，我把《月檐》打包成一个完全自包含的 HTML 单文件，现在生成 `output/moonroof.html`。\n\nCSS、背景画面、音效与游戏逻辑全部内联，不依赖 `game.js`。',
      attachments: running ? undefined : [{ id: 'f1', name: 'moonroof.html', size: 64922, mimeType: 'text/html', metadata: { verification: 'verified' } }] as never }),
  ];
}
export function render(items: ConversationItem[], status: 'running' | 'completed' = 'completed', t = (key: string) => key) {
  const state = reducer.reduceConversation(reducer.createConversationState('7'), { type: 'event.received', event: {
    protocolVersion: 2, type: 'snapshot', conversationKey: '7', eventId: 'snapshot', cursor: 'c', turnId: 'main', streamId: 'snapshot', lane: 'system',
    revision: 0, seq: 0, timestamp: '2026-11-19T15:01:06Z', snapshot: { items, status, hasOlder: false },
  } } as never);
  const messages = projection.toThreadMessages(state);
  function App() {
    const runtime = aui.useExternalStoreRuntime({ messages, convertMessage: (message: never) => message, isRunning: status === 'running', onNew: async () => {} });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t }))));
  }
  const html = renderToString(React.createElement(App));
  return { html, dom: new JSDOM(html).window.document };
}

test('tokens: one content column shared by messages, welcome and composer; OWUI-scale body type', () => {
  const source = css();
  assert.match(rule(source, '.mc-root'), /--mc-col: 48rem;/);
  for (const selector of ['.mc-msg', '.mc-composer', '.mc-welcome']) assert.match(rule(source, selector), /max-width: var\(--mc-col\);/, selector);
  assert.match(rule(source, '.mc-msg'), /font-size: 14\.5px;/);
  assert.doesNotMatch(source, /max-width: 760px/, 'no second hard-coded column width');
});

test('user message: light rounded bubble like OWUI UserMessage, no brand gradient, no duplicate 你 badge', () => {
  const source = css();
  const bubble = rule(source, '.mc-msg[data-message-role="user"] .mc-bubble');
  assert.match(bubble, /background: var\(--bg-fill\);/);
  assert.match(bubble, /border-radius: 24px;/);
  assert.doesNotMatch(bubble, /gradient|#fff/);
  const { dom } = render(scene(1), 'completed', zh);
  const user = dom.querySelector('[data-message-role="user"]')!;
  assert.equal(user.querySelector('.mc-avatar'), null, 'no avatar badge on the user side');
  assert.equal(user.querySelector('.mc-header'), null, 'no header row above the user bubble');
  assert.ok(user.querySelector('.mc-bubble + .mc-actions, .mc-bubble ~ .mc-actions'), 'actions stay under the bubble');
  assert.ok(user.querySelector('.mc-actions .mc-source-toggle'), '原文 moves into the hover bar, still reachable');
  assert.ok(user.querySelector('.mc-actions time.mc-time'), 'exact time stays reachable');
});

test('assistant: body indented under the name; process and thinking are one flat line each, not cards', () => {
  const source = css();
  assert.match(rule(source, '.mc-msg[data-message-role="assistant"] .mc-bubble'), /padding: 0 0 0 32px;/);
  const proc = rule(source, '.mc-process');
  assert.doesNotMatch(proc, /border:|background:/, 'closed fold has no card chrome');
  assert.doesNotMatch(source, /\.mc-process\[open\] \{[^}]*background/, 'open fold is not a card either');
  assert.match(rule(source, '.mc-process-history'), /max-height: 320px;/);
  assert.match(rule(source, '.mc-process-history'), /border-left: 1px solid var\(--border-divider\);/);
  const { dom } = render(scene(5), 'completed', zh);
  const assistant = dom.querySelector('[data-message-role="assistant"]')!;
  assert.equal(assistant.querySelectorAll('details.mc-process:not(.mc-reasoning)').length, 1);
  assert.equal(assistant.querySelectorAll('details.mc-reasoning').length, 1, 'thinking uses the same fold');
  assert.ok(assistant.querySelector('details.mc-reasoning > summary .mc-process-chevron'), 'thinking has the same chevron head');
  assert.equal(assistant.querySelectorAll('.mc-step-tag').length, 0, 'no repeated [工具] capsule per call');
  assert.equal(assistant.querySelectorAll('.mc-step').length, 5, 'every real call is still listed');
  assert.match(assistant.querySelector('.mc-process-summary')!.textContent!, /5/);
});

test('every call keeps its record and failed calls stay neutral but truthful', () => {
  const { dom } = render(scene(5), 'completed', zh);
  const failed = dom.querySelectorAll('.mc-step[data-state="failed"]');
  assert.equal(failed.length, 1, 'backend failure state is preserved on the row');
  assert.match(failed[0]!.textContent!, /exit 1: game.js not found/, 'original record is reachable');
  assert.doesNotMatch(css(), /\.mc-step\[data-state="failed"\][^{]*\{[^}]*(--fg-error|red)/, 'intermediate failure is not painted red');
});

test('private IO stays admin-only: non-admin renders no 完整输入输出 entry', async () => {
  admin = false;
  const plain = render(scene(2), 'completed', zh).html;
  assert.doesNotMatch(plain, /mc-tool-io/);
});

test('activity: exactly one live line while streaming, with shimmer text; none at rest', () => {
  const live = render(scene(3, 'running'), 'running', zh).dom;
  assert.equal(live.querySelectorAll('.mc-process-current').length, 1);
  assert.ok(live.querySelector('.mc-process-current .mc-shimmer'));
  const done = render(scene(3), 'completed', zh).dom;
  assert.equal(done.querySelectorAll('.mc-process-current').length, 0);
});

test('composer: OWUI-style quiet frame (24px radius, hairline, soft large shadow), ghost tool buttons, dark send', () => {
  const source = css();
  const composer = rule(source, '.mc-composer');
  assert.match(composer, /border-radius: 24px;/);
  assert.match(composer, /border: 1px solid var\(--border-divider\);/);
  assert.match(composer, /box-shadow: 0 10px 15px -3px/);
  assert.doesNotMatch(rule(source, '.mc-composer:focus-within'), /0 0 0 4px/, 'no glow ring; edge only');
  assert.match(rule(source, '.mc-pill'), /border: 1px solid transparent;/, 'tool buttons lose capsule borders');
  assert.match(rule(source, '.mc-send'), /background: var\(--fg-primary\);/);
});

test('motion: only send/stream/fold/menu/attachment entrances; all off under prefers-reduced-motion', () => {
  const source = css();
  const keyframes = [...source.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(keyframes, ['mc-controls-in', 'mc-pop', 'mc-pulse', 'mc-rise', 'mc-shimmer', 'mc-spin'].sort());
  assert.match(source, /\.mc-msg\[data-last\] \{[^}]*animation: mc-rise/, 'new message rises in');
  assert.match(source, /\.mc-chip, \.mc-chip-slot > \.mc-chip \{[^}]*animation: mc-rise/, 'attachments enter');
  assert.match(source, /\.mc-menu:not\(\[hidden\]\) \{[^}]*animation: mc-pop/, 'menus pop');
  assert.doesNotMatch(source, /scroll-behavior: smooth/, 'never animates scroll');
  const reduced = source.slice(source.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.mc-root \*[^{]*\{[^}]*animation: none !important;[^}]*transition: none !important;/s);
});

test('narrow: 520px drops the indent and tool labels, keeps every control reachable', () => {
  const narrow = css().slice(css().indexOf('@media (max-width: 520px)'));
  assert.match(narrow, /\.mc-msg\[data-message-role="assistant"\] \.mc-bubble \{ padding-left: 0; \}/);
  assert.match(narrow, /\.mc-pill-text, \.mc-model-exec \{ display: none; \}/);
});

test('capture fixture HTML for real browser screenshots (CAPTURE_DIR)', () => {
  const dir = process.env.CAPTURE_DIR;
  if (!dir) return;
  for (const [name, items, status] of [['done', scene(5), 'completed'], ['stream', scene(3, 'running'), 'running'], ['fifty', scene(50), 'completed'], ['one', scene(1), 'completed']] as const) {
    writeFileSync(`${dir}/${name}.html`, render(items as ConversationItem[], status, zh).html);
  }
});

test('deliverables: an HTML result renders as a verified download card (same Storage path as every file)', () => {
  const { dom } = render(scene(1), 'completed', zh);
  const card = dom.querySelector('[data-message-role="assistant"] button.mc-chip--link');
  assert.ok(card, 'download card');
  assert.match(card!.textContent!, /moonroof\.html.*63\.4 KB/);
  assert.match(card!.getAttribute('title')!, /moonroof\.html/);
});
