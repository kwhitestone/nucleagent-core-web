import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';
import type { ConversationItem } from '../src/addons/conversation/task-conversation/core/types.ts';
import { ZH_STRINGS } from '../src/chat-react/islandStringsZh.ts';

let vite: ViteDevServer;
let app: typeof import('../src/chat-react/ChatApp.tsx');
let projection: typeof import('../src/chat-react/threadMessages.ts');
let reducer: typeof import('../src/addons/conversation/task-conversation/core/reducer.ts');
let React: typeof import('react');
let aui: typeof import('@assistant-ui/react');
let renderToString: typeof import('react-dom/server').renderToString;
let Viewport: import('react').ElementType;
let unregister: () => void;
before(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new JSDOM('').window });
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule('/src/contracts/platform-runtime.ts');
  unregister = registerPlatformRuntime({ useEmbeddedAuthorization: () => ({ can: () => false }) });
  app = await vite.ssrLoadModule('/src/chat-react/ChatApp.tsx');
  Viewport = (await vite.ssrLoadModule('/src/chat-react/auiPrimitives.ts')).ThreadPrimitive.Viewport;
  projection = await vite.ssrLoadModule('/src/chat-react/threadMessages.ts');
  reducer = await vite.ssrLoadModule('/src/addons/conversation/task-conversation/core/reducer.ts');
  React = await import('react');
  aui = await import('@assistant-ui/react');
  ({ renderToString } = await import('react-dom/server'));
});
after(async () => { unregister(); await vite.close(); });
const item = (id: string, changes: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: 'main', streamId: id, lane: 'answer', role: 'assistant', kind: 'text', content: '',
  status: 'complete', revision: 1, seq: 1, timestamp: '2026-11-19T00:00:00Z', userReadable: true, ...changes,
});
const call = (id: string, status: ConversationItem['status']) => item(id, { lane: 'process', kind: 'tool_call', title: '命令执行', status,
  content: '执行命令失败 · 0.0 秒', data: { toolCallId: id, toolStatus: 'failed', durationMs: 0 } });
function render(items: ConversationItem[], status = 'running') {
  const state = reducer.reduceConversation(reducer.createConversationState('7'), { type: 'event.received', event: {
    protocolVersion: 2, type: 'snapshot', conversationKey: '7', eventId: 'snapshot', cursor: 'c', turnId: 'main', streamId: 'snapshot', lane: 'system',
    revision: 0, seq: 0, timestamp: '2026-11-19T00:00:00Z', snapshot: { items, status, hasOlder: false },
  } } as never);
  const messages = projection.toThreadMessages(state);
  function App() {
    const runtime = aui.useExternalStoreRuntime({ messages, convertMessage: message => message, isRunning: status === 'running', onNew: async () => {} });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t: (key: string) => {
        if (!process.env.CAPTURE_HTML) return key;
        return key.startsWith('chatReact.') ? ZH_STRINGS[key.slice(10) as keyof typeof ZH_STRINGS] ?? key : ({ 'home.greeting': 'NucleAgent', 'conversation.you': '你', 'common.copy': '复制' }[key] ?? key);
      } }))));
  }
  const html = renderToString(React.createElement(App));
  return { messages, html, dom: new JSDOM(html).window.document };
}
const fixture = (status: ConversationItem['status'] = 'streaming') => [
  item('user', { role: 'user', content: '再做一个小游戏吧' }),
  item('queue', { lane: 'process', title: '排队等待', data: { executionPhase: 'execution_queue' } }),
  call('msg-1', 'failed'), call('msg-2', 'complete'),
  item('heartbeat', { lane: 'process', title: '思考中', status, content: '正在处理请求，等待首个可展示内容…', data: { thinkingStatus: true, thinking: true } }),
  item('thought', { lane: 'process', status, content: '服务端授权的思考正文', data: { modelThinking: true } }),
  item('answer', { content: '入口与界面已经搭好，接下来补充游戏逻辑。', status }),
];
test('active skill preparation is visible in the fold summary before model output', () => {
  const { dom } = render([
    item('user', { role: 'user', content: '画一只小猫' }),
    item('skill', { lane: 'process', kind: 'status', role: 'system', status: 'streaming',
      title: '技能准备', content: '正在检索适用技能', data: { skillProcess: true, mainRun: false } }),
  ]);
  assert.equal(dom.querySelector('.mc-process-summary')?.textContent, '正在检索适用技能');
  assert.equal(dom.querySelector('.mc-thinking'), null);
});
test('one turn activity; actual calls only; existing answer never waits for first content', () => {
  const { html, dom } = render(fixture());
  if (process.env.CAPTURE_HTML) writeFileSync(process.env.CAPTURE_HTML, html);
  assert.equal(dom.querySelectorAll('[role="status"]').length, 1);
  assert.equal(dom.querySelectorAll('.mc-step').length, 2);
  assert.equal(dom.querySelectorAll('.mc-spinner').length, 1);
  assert.doesNotMatch(html, /等待首个可展示内容|mc-process-failures|mc-process-alert|存在失败/);
  assert.doesNotMatch(dom.querySelector('.mc-reasoning summary')!.textContent!, /thinking/);
});
test('neutral records preserve failed call identity and backend truth, with details reachable', () => {
  const { messages, dom } = render(fixture());
  const calls = (messages[1].content as { type: string; toolCallId?: string; isError?: boolean }[]).filter(part => part.type === 'tool-call');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].isError, true);
  assert.equal(calls[0].toolCallId, 'msg-1');
  assert.equal(dom.querySelectorAll('.mc-step[data-state="failed"]').length, 1);
  assert.equal(dom.querySelector('.mc-step[data-state="failed"] .mc-step-state'), null);
  assert.ok(dom.querySelector('.mc-step[data-state="failed"] details pre'));
  assert.equal(dom.querySelectorAll('.mc-tool-io').length, 0);
});
test('terminal success/cancel/failure and restored snapshots stop activity; final risks survive once', () => {
  for (const terminal of ['complete', 'failed', 'cancelled'] as const) {
    const items = fixture(terminal);
    items.push(item('final', { lane: 'system', status: terminal, content: '真实最终风险：产物未交付，请检查权限。' }));
    const { html, dom } = render(items, terminal === 'complete' ? 'completed' : terminal);
    assert.equal(dom.querySelectorAll('.mc-process-current').length, 0, dom.querySelector('[role="status"]')?.outerHTML);
    assert.equal((html.match(/真实最终风险：产物未交付，请检查权限。/g) ?? []).length, 1);
  }
});
test('tool-only streaming, no-tool streaming and fifty independent retry calls each have one activity', () => {
  for (const items of [[item('answer', { status: 'streaming', content: '已有正文' })], [call('msg-1', 'streaming')],
    [...Array.from({ length: 49 }, (_, index) => call(`msg-${index + 1}`, 'failed')), call('msg-50', 'streaming')]]) {
    const { dom } = render(items);
    assert.equal(dom.querySelectorAll('[role="status"]').length, 1);
    assert.equal(dom.querySelectorAll('.mc-spinner').length, 1);
    assert.equal(dom.querySelectorAll('.mc-step').length, items.filter(entry => entry.kind === 'tool_call').length);
  }
});
test('late terminal snapshot suppresses stale running rows; older turns cannot claim current activity', () => {
  const stale = fixture();
  const ended = render(stale, 'failed');
  assert.equal(ended.dom.querySelectorAll('.mc-process-current').length, 0);
  assert.equal(ended.messages[1].status?.type, 'running');
  const next = [...stale, item('user2', { role: 'user', content: '新问题' }), item('answer2', { status: 'streaming', content: '新回答' })];
  const { dom } = render(next);
  assert.equal(dom.querySelectorAll('.mc-process-current').length, 1);
  assert.equal(dom.querySelector('.mc-process-current')?.closest('[data-scroll-message]')?.getAttribute('data-scroll-message'), 'answer2');
});
