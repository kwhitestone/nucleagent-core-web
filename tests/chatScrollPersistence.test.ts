import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';

const browser = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
let vite: any, React: any, createRoot: any, aui: any, Viewport: any;
before(async () => {
  for (const [name, value] of Object.entries({ window: browser.window, document: browser.window.document, navigator: browser.window.navigator,
    HTMLElement: browser.window.HTMLElement, Element: browser.window.Element, MutationObserver: browser.window.MutationObserver,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: any) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { configurable: true, value });
  browser.window.HTMLElement.prototype.scrollTo = function(options: any) { this.scrollTop = options.top; };
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import('react'); ({ createRoot } = await import('react-dom/client')); aui = await import('@assistant-ui/react');
  const primitives = await vite.ssrLoadModule('/src/chat-react/auiPrimitives.ts');
  try { ({ ScrollViewport: Viewport } = await vite.ssrLoadModule('/src/chat-react/ScrollViewport.tsx')); }
  catch { Viewport = primitives.ThreadPrimitive.Viewport; }
});
after(async () => { await vite?.close(); browser.window.close(); });

for (const environment of ['dev', 'test', 'pre', 'prod']) {
  test(`${environment}: saved real scroll failure survives A → B → A remount`, async () => {
    const evidence = JSON.parse(readFileSync(new URL(`../../acceptance-evidence/${environment}-scroll.json`, import.meta.url), 'utf8'));
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
