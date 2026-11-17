import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer, type ViteDevServer } from 'vite';
import { initializeRuntimeFixture } from './fixtures/runtimeConfig.ts';

let vite: ViteDevServer;
let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let aui: typeof import('@assistant-ui/react');
let app: typeof import('../src/chat-react/ChatApp.tsx');
let createActions: typeof import('../src/chat-react/messageActions.ts').createMessageActions;
let primitives: typeof import('../src/chat-react/auiPrimitives.ts');
const browser = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });

before(async () => {
  for (const [name, value] of Object.entries({ window: browser.window, document: browser.window.document, navigator: browser.window.navigator,
    HTMLElement: browser.window.HTMLElement, Element: browser.window.Element, MutationObserver: browser.window.MutationObserver,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { configurable: true, value });
  vite = await createServer({ appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  aui = await import('@assistant-ui/react');
  app = await vite.ssrLoadModule('/src/chat-react/ChatApp.tsx');
  primitives = await vite.ssrLoadModule('/src/chat-react/auiPrimitives.ts');
  ({ createMessageActions: createActions } = await vite.ssrLoadModule('/src/chat-react/messageActions.ts'));
});
after(async () => { await vite?.close(); browser.window.close(); });

test('real message controls vote/revoke, restore feedback details, edit/cancel/save and regenerate through a branch', async () => {
  const calls: unknown[][] = [];
  const question = { id: 1, content: '  original\n**text**  ', attachments: [{ fileId: 'file-1', name: 'test.txt' }] };
  let redraw = () => {};
  const actions = createActions({
    isCurrent: () => true, isRunning: () => false,
    list: async () => [],
    set: async (id, value) => { calls.push(['set', id, value]); return { messageId: id, ...value }; },
    clear: async (id) => { calls.push(['clear', id]); },
    fork: async (id, before, content) => { calls.push(['fork', id, before, content]); return { id: 30 }; },
    send: async (id, content, attachments) => { calls.push(['send', id, content, attachments]); },
    navigate: (id) => { calls.push(['navigate', id]); }, created: () => { calls.push(['refresh']); },
  }, () => redraw());
  await actions.load();
  const rootElement = document.createElement('div'); document.body.append(rootElement);
  const root = createRoot(rootElement);
  function View() {
    const [, update] = React.useState(0); redraw = () => update((value) => value + 1);
    const runtime = aui.useExternalStoreRuntime<import('@assistant-ui/react').ThreadMessageLike>({ messages: [
      { id: 'msg-1', role: 'user', content: [{ type: 'text', text: question.content }], metadata: { custom: { question } } },
      { id: 'msg-2', role: 'assistant', content: [{ type: 'text', text: 'answer' }], status: { type: 'complete', reason: 'stop' }, metadata: { custom: { question, feedbackMessageId: 2 } } },
    ], isRunning: false, convertMessage: (message) => message, onNew: async () => {} });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(primitives.ThreadPrimitive.Viewport, null,
      React.createElement(primitives.ThreadPrimitive.Messages, null,
        ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t: (key: string) => key, actions }))));
  }
  const button = (label: string) => {
    const found = rootElement.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(found, `missing ${label}`); return found;
  };
  const click = async (element: HTMLElement) => { await React.act(async () => element.click()); };
  const formButton = (label: string) => {
    const found = [...rootElement.querySelectorAll<HTMLButtonElement>('.mc-message-form button')].find((node) => node.textContent === label);
    assert.ok(found, label); return found;
  };
  try {
    await React.act(async () => root.render(React.createElement(View)));
    await click(button('chatReact.good'));
    assert.equal(button('chatReact.good').getAttribute('aria-pressed'), 'true');
    await click(button('chatReact.bad'));
    assert.equal(button('chatReact.good').getAttribute('aria-pressed'), 'false');
    assert.equal(button('chatReact.bad').getAttribute('aria-pressed'), 'true');
    assert.equal(rootElement.querySelectorAll('.mc-feedback-reasons button').length, 8);
    await click(formButton('common.cancel'));
    await React.act(async () => { await actions.details(2, 'other', 'stored reason'); });
    await click(button('chatReact.feedbackDetails'));
    assert.equal(rootElement.querySelector('textarea')?.value, 'stored reason');
    await click(formButton('chatReact.save'));
    assert.equal(actions.feedback.get(2)?.reason, 'other');
    await click(button('chatReact.bad'));
    assert.equal(button('chatReact.bad').getAttribute('aria-pressed'), 'false');
    assert.equal(rootElement.querySelector('.mc-feedback-reasons'), null);
    await click(button('chatReact.edit'));
    assert.equal(rootElement.querySelector('textarea')?.value, question.content);
    await click(formButton('common.cancel'));
    assert.equal(rootElement.querySelector('textarea'), null);
    assert.equal(calls.some((call) => call[0] === 'fork'), false);
    await click(button('chatReact.edit'));
    await click(formButton('chatReact.save'));
    assert.deepEqual(calls.find((call) => call[0] === 'fork'), ['fork', 1, false, question.content]);
    calls.length = 0;
    await click(button('chatReact.reload'));
    assert.deepEqual(calls[0], ['fork', 1, true, undefined]);
    assert.deepEqual(calls.find((call) => call[0] === 'send'), ['send', 30, question.content, question.attachments]);
  } finally { await React.act(async () => root.unmount()); rootElement.remove(); }
});
