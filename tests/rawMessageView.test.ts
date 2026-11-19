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

async function mount(content: string | string[], running = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const translate = (key: string) => ({ 'chatReact.rawView': '原文', 'chatReact.renderedView': '返回排版' })[key] ?? key;
  function View({ body, active, id }: { body: string | string[]; active: boolean; id: string }) {
    const runtime = aui.useExternalStoreRuntime<import('@assistant-ui/react').ThreadMessageLike>({
      messages: [{ id, role: 'assistant', content: (Array.isArray(body) ? body : [body]).map((text) => ({ type: 'text' as const, text })),
        status: active ? { type: 'running' } : { type: 'complete', reason: 'stop' } }],
      isRunning: active, convertMessage: (message) => message, onNew: async () => { throw new Error('send prohibited'); },
    });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime },
      React.createElement(primitives.ThreadPrimitive.Viewport, null,
        React.createElement(primitives.ThreadPrimitive.Messages, null,
          () => React.createElement(app.MessageRow, { role: 'assistant', conversationId: '1471', t: translate }))));
  }
  const update = async (body: string | string[], active = false, id = '13051') => {
    await React.act(async () => root.render(React.createElement(View, { body, active, id })));
  };
  await update(content, running);
  return { container, update, raw: () => container.querySelector<HTMLElement>('.mc-raw-body'),
    toggle: () => container.querySelector<HTMLButtonElement>('.mc-source-toggle')!,
    click: async (button: HTMLButtonElement) => { await React.act(async () => button.click()); },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); } };
}

test('entire immutable 13051 explicitly displays exact text and preserves nested JSON and raw copy', async () => {
  assert.equal(createHash('sha256').update(fixture.content).digest('hex'), fixture.contentSha256);
  const view = await mount(fixture.content);
  try {
    const markdown = view.container.querySelector('.mc-md')!.innerHTML;
    assert.equal(markdown, '<p>我会读取“豆瓣资源搜索”技能正文，并按正文转换 query 参数。<br>\n{"query":"{"keyword":"甄嬛传","cat":"1002"}"}</p>\n<p>分类依据：技能正文规定电视剧的 cat 为“1002”。</p>\n');
    assert.equal(view.raw(), null);
    assert.ok(view.toggle(), 'explicit raw view control exists');
    assert.equal(view.toggle().textContent, '原文');
    assert.equal(view.toggle().type, 'button');
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'false');
    view.toggle().focus();
    assert.equal(document.activeElement, view.toggle());
    await view.click(view.toggle());
    assert.equal(view.toggle().textContent, '返回排版');
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(view.raw()!.textContent, fixture.content);
    assert.equal(view.raw()!.tagName, 'PRE');
    assert.equal(view.raw()!.tabIndex, 0);
    assert.deepEqual(JSON.parse(JSON.parse(view.raw()!.textContent!.split('\n')[1]).query), { keyword: '甄嬛传', cat: '1002' });
    await view.click(view.container.querySelector<HTMLButtonElement>('[aria-label="common.copy"]')!);
    assert.equal(copied.at(-1), fixture.content);
    await view.click(view.toggle());
    assert.equal(view.raw(), null);
    assert.equal(view.container.querySelector('.mc-md')!.innerHTML, markdown);
  } finally { await view.close(); }
});

test('raw is safe text, stays exact on streaming updates, and resets for another message/reentry', async () => {
  const payload = '<script>globalThis.pwned=1</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>\\\n';
  const view = await mount(payload, true);
  try {
    await view.click(view.toggle());
    assert.equal(view.raw()!.textContent, payload);
    assert.equal(view.raw()!.children.length, 0);
    await view.update(payload + fixture.content, true);
    assert.equal(view.raw()!.textContent, payload + fixture.content);
    await view.update(payload + fixture.content);
    assert.equal(view.raw()!.textContent, payload + fixture.content);
    await view.update('another **message**', false, '13052');
    assert.equal(view.raw(), null);
    assert.ok(view.container.querySelector('.mc-md strong'));
  } finally { await view.close(); }
  const reentry = await mount(fixture.content);
  try {
    assert.equal(reentry.raw(), null);
    await reentry.click(reentry.toggle());
    assert.equal(reentry.raw()!.textContent, fixture.content);
  } finally { await reentry.close(); }
});

test('long text is complete within a keyboard-scrollable bounded region', async () => {
  const text = ('x'.repeat(1000) + '\n').repeat(500);
  const view = await mount(text);
  try {
    await view.click(view.toggle());
    assert.equal(view.raw()!.textContent, text);
    assert.equal(view.raw()!.getAttribute('role'), 'region');
    assert.equal(view.raw()!.getAttribute('aria-label'), '原文');
    const styles = readFileSync(new URL('../src/chat-react/chat.css', import.meta.url), 'utf8');
    assert.match(styles, /\.mc-raw-body\s*\{[^}]*max-height:\s*60vh/);
    assert.match(styles, /\.mc-raw-body\s*\{[^}]*overflow:\s*auto/);
  } finally { await view.close(); }
});

test('multiple text parts follow the existing copy separator and preserve blank lines', async () => {
  const parts = ['first\\\n', '\n' + fixture.content];
  const view = await mount(parts);
  try {
    await view.click(view.toggle());
    await view.click(view.container.querySelector<HTMLButtonElement>('[aria-label="common.copy"]')!);
    assert.equal(view.raw()!.textContent, parts.join('\n\n'));
    assert.equal(view.raw()!.textContent, copied.at(-1));
  } finally { await view.close(); }
});
