import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';

const browser = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
let vite: any, React: any, createRoot: any, aui: any, Viewport: any;
const resizeCallbacks = new Set<() => void>();
before(async () => {
  for (const [name, value] of Object.entries({ window: browser.window, document: browser.window.document, navigator: browser.window.navigator,
    HTMLElement: browser.window.HTMLElement, Element: browser.window.Element, MutationObserver: browser.window.MutationObserver,
    ResizeObserver: class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe() { resizeCallbacks.add(this.callback); } unobserve() {} disconnect() { resizeCallbacks.delete(this.callback); } },
    requestAnimationFrame: (callback: any) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { configurable: true, value });
  browser.window.HTMLElement.prototype.scrollTo = function(options: any) { this.scrollTop = options.top; };
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import('react'); ({ createRoot } = await import('react-dom/client')); aui = await import('@assistant-ui/react');
  ({ ScrollViewport: Viewport } = await vite.ssrLoadModule('/src/chat-react/ScrollViewport.tsx'));
});
after(async () => { await vite?.close(); browser.window.close(); });

for (const environment of ['dev', 'test', 'pre', 'prod']) {
  test(`${environment}: saved real scroll failure survives A → B → A remount`, async () => {
    const evidence = JSON.parse(readFileSync(new URL('./fixtures/scrollFailures.json', import.meta.url), 'utf8')).find((entry: any) => entry.environment === environment);
    assert.equal(evidence.messagesUnchanged, true);
    assert.equal(evidence.positionRetained, false);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    function View({ id }: { id: string }) {
      const runtime = aui.useExternalStoreRuntime({ messages: [{ id: 'message', role: 'user', content: [{ type: 'text', text: 'fixture' }] }], isRunning: false, convertMessage: (value: any) => value, onNew: async () => {} });
      return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, { conversationId: id, ready: true, className: 'viewport' }, React.createElement('div', null, 'fixture')));
    }
    async function show(id: string) { await React.act(async () => root.render(React.createElement(View, { id, key: id }))); }
    const geometry = { scrollHeight: evidence.before.height, clientHeight: evidence.before.client };
    for (const [name, value] of Object.entries(geometry)) Object.defineProperty(browser.window.HTMLElement.prototype, name, { configurable: true, get: () => value });
    try {
      const id = `${environment}:${evidence.conversationId}`;
      await show(id);
      const region = container.querySelector('.viewport') as HTMLElement;
      region.scrollTop = evidence.before.top;
      await React.act(async () => region.dispatchEvent(new browser.window.Event('scroll')));
      await show(`${id}:alternate`);
      await show(id);
      assert.ok(Math.abs((container.querySelector('.viewport') as HTMLElement).scrollTop - evidence.before.top) < 2, 'return to saved reading position, not bottom or top');
    } finally { await React.act(async () => root.unmount()); container.remove(); }
  });
}

test('real viewport preserves anchors on prepends/images, follows only at bottom, waits for history and clears account state', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let height = 3000, anchorTop = 900;
  Object.defineProperty(browser.window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(browser.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  const originalRect = browser.window.HTMLElement.prototype.getBoundingClientRect;
  browser.window.HTMLElement.prototype.getBoundingClientRect = function() {
    const region = this.closest('.viewport');
    const top = this.hasAttribute('data-scroll-message') ? anchorTop - (region?.scrollTop ?? 0) : 0;
    return { top, bottom: top + 500, left: 0, right: 100, width: 100, height: 500, x: 0, y: top, toJSON() {} };
  };
  function View({ id, ready }: { id: string; ready: boolean }) {
    const runtime = aui.useExternalStoreRuntime({ messages: [], isRunning: false, convertMessage: (value: any) => value, onNew: async () => {} });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, { conversationId: id, ready, className: 'viewport' }, React.createElement('div', { 'data-scroll-message': 'anchor' }, 'fixture')));
  }
  const show = async (id = 'lifecycle', ready = true) => { await React.act(async () => root.render(React.createElement(View, { id, ready, key: id }))); };
  const region = () => container.querySelector('.viewport') as HTMLElement;
  const scroll = async (top: number) => { region().scrollTop = top; await React.act(async () => region().dispatchEvent(new browser.window.Event('scroll'))); };
  const resize = async () => { await React.act(async () => { for (const callback of resizeCallbacks) callback(); await new Promise(resolve => setTimeout(resolve, 20)); }); };
  try {
    await show(); await scroll(1000);
    await show('other'); await show('lifecycle', false);
    assert.equal(region().scrollTop, 0, 'loading has not consumed saved state');
    await show(); assert.equal(region().scrollTop, 1000);
    height += 400; anchorTop += 400; await resize();
    assert.equal(region().scrollTop, 1400, 'prepend/image above anchor retains reading offset');
    height += 400; await resize();
    assert.equal(region().scrollTop, 1400, 'streaming below detached reader does not jump');
    await scroll(height - 600); height += 400; await resize();
    assert.equal(region().scrollTop, height, 'following reader tracks streamed growth');
    await scroll(1200);
    await React.act(async () => window.dispatchEvent(new browser.window.CustomEvent('nucleagent:session-change', { detail: { authenticated: true, businessBoundaryChanged: false } })));
    await show('other'); await show(); assert.equal(region().scrollTop, 1200, 'same principal renewal preserves position');
    await React.act(async () => window.dispatchEvent(new browser.window.CustomEvent('nucleagent:session-change', { detail: { authenticated: false } })));
    await scroll(600);
    await show('other'); await show(); assert.equal(region().scrollTop, height, 'retired account cannot repopulate saved position');
  } finally {
    await React.act(async () => root.unmount()); container.remove();
    browser.window.HTMLElement.prototype.getBoundingClientRect = originalRect;
  }
  assert.equal(resizeCallbacks.size, 0, 'component observers are disconnected');
});
