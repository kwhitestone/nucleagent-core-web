import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer, type ViteDevServer } from 'vite';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/persisted-message13051.json', import.meta.url), 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
let vite: ViteDevServer;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let aui: typeof import('@assistant-ui/react');
let app: typeof import('../src/chat-react/ChatApp.tsx');
let primitives: typeof import('../src/chat-react/auiPrimitives.ts');
const copied: string[] = [];

before(async () => {
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true,
    value: { writeText: async (text: string) => { copied.push(text); } } });
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  aui = await import('@assistant-ui/react');
  app = await vite.ssrLoadModule('/src/chat-react/ChatApp.tsx');
  primitives = await vite.ssrLoadModule('/src/chat-react/auiPrimitives.ts');
});
after(async () => { await vite?.close(); dom.window.close(); });

async function mount(content: string | string[], running = false, role: 'assistant' | 'user' = 'assistant') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const translate = (key: string) => key;
  function View({ body, active, id }: { body: string | string[]; active: boolean; id: string }) {
    const runtime = aui.useExternalStoreRuntime<import('@assistant-ui/react').ThreadMessageLike>({
      messages: [{ id, role, content: (Array.isArray(body) ? body : [body]).map((text) => ({ type: 'text' as const, text })),
        ...(role === 'assistant' ? { status: active ? { type: 'running' as const } : { type: 'complete' as const, reason: 'stop' as const } } : {}) }],
      isRunning: active, convertMessage: (message) => message, onNew: async () => { throw new Error('send prohibited'); },
    });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime },
      React.createElement(primitives.ThreadPrimitive.Viewport, null,
        React.createElement(primitives.ThreadPrimitive.Messages, null,
          () => React.createElement(app.MessageRow, { role, conversationId: '1471', t: translate }))));
  }
  const update = async (body: string | string[], active = false, id = '13051') => {
    await React.act(async () => root.render(React.createElement(View, { body, active, id })));
  };
  await update(content, running);
  // Presence checks return booleans: a failing assert on a JSDOM node inspects the whole DOM graph (exp101: ~63GB OOM).
  return { container, update, raw: () => container.querySelector('.mc-raw-body') !== null,
    toggle: () => container.querySelector('.mc-source-toggle') !== null,
    has: (selector: string) => container.querySelector(selector) !== null,
    click: async (button: HTMLButtonElement) => { await React.act(async () => button.click()); },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); } };
}

// MUYU-365 exp101 (user item 3): the 原文/返回排版 switch is gone; every message is always the formatted view.
// Copy (aui ActionBar) still copies the exact source text.
for (const role of ['assistant', 'user'] as const) {
  test(`${role}: no 原文/返回排版 control and no raw <pre>, markdown renders as elements`, { timeout: 30000 }, async () => {
    const view = await mount('**b** and `c`\n\n```\nx < y\n```', false, role);
    try {
      assert.equal(view.toggle(), false, 'no .mc-source-toggle');
      assert.equal(view.raw(), false, 'no .mc-raw-body');
      assert.ok(view.has('.mc-md strong'), 'bold is an element');
      assert.ok(view.has('.mc-md pre code, .mc-md pre'), 'code block is an element');
      assert.doesNotMatch(view.container.textContent ?? '', /chatReact\.(rawView|renderedView)/);
    } finally { await view.close(); }
  });
}

test('entire immutable 13051 renders formatted, copy still yields the exact source', { timeout: 30000 }, async () => {
  assert.equal(createHash('sha256').update(fixture.content).digest('hex'), fixture.contentSha256);
  const view = await mount(fixture.content);
  try {
    assert.equal(String(view.container.querySelector('.mc-md')?.innerHTML), '<p>我会读取“豆瓣资源搜索”技能正文，并按正文转换 query 参数。<br>\n{"query":"{"keyword":"甄嬛传","cat":"1002"}"}</p>\n<p>分类依据：技能正文规定电视剧的 cat 为“1002”。</p>\n');
    assert.equal(view.toggle(), false);
    assert.equal(view.raw(), false);
    await view.click(view.container.querySelector<HTMLButtonElement>('[aria-label="common.copy"]')!);
    assert.equal(copied.at(-1), fixture.content);
  } finally { await view.close(); }
});

test('streaming updates stay formatted and unsafe markup stays inert', { timeout: 30000 }, async () => {
  const payload = '<script>globalThis.pwned=1</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>\\\n';
  const view = await mount(payload, true);
  try {
    assert.equal(view.toggle(), false);
    await view.update(payload + '**streamed**', true);
    assert.ok(view.has('.mc-md strong'), 'formatted while streaming');
    assert.equal(view.raw(), false);
    await view.update(payload + '**streamed** done');
    assert.ok(view.has('.mc-md strong'), 'formatted after completion');
    assert.equal(view.has('script'), false);
    assert.equal(view.has('[onerror]'), false);
    assert.equal(view.toggle(), false);
    assert.equal(view.raw(), false);
  } finally { await view.close(); }
});

test('multiple text parts copy with the existing separator; the stylesheet has no toggle/raw rules', { timeout: 30000 }, async () => {
  const parts = ['first\\\n', '\n' + fixture.content];
  const view = await mount(parts);
  try {
    await view.click(view.container.querySelector<HTMLButtonElement>('[aria-label="common.copy"]')!);
    assert.equal(copied.at(-1), parts.join('\n\n'));
  } finally { await view.close(); }
  const styles = readFileSync(new URL('../src/chat-react/chat.css', import.meta.url), 'utf8');
  assert.doesNotMatch(styles, /mc-source-toggle|mc-raw-body/);
  for (const locale of ['islandStringsZh', 'islandStringsEn']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/chat-react/${locale}.ts`, import.meta.url), 'utf8'), /rawView|renderedView/, locale);
  }
});
