import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createMemoryHistory, createRouter } from 'vue-router';
import { shellViewLocation } from '../src/addons/conversation/composables/shellMessagePolicy.ts';
const source = readFileSync(new URL('../src/addons/conversation/composables/useShellBridge.ts', import.meta.url), 'utf8');
const entry = source.slice(source.indexOf('    const current = router.currentRoute.value;'), source.indexOf('\n  const onMessage'));
const code = ts.transpileModule('(function () {' + entry + ')()', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function bridge(current: string, target: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] });
  await router.push(current);
  const pushed: string[] = [];
  const ctx = { router: { currentRoute: router.currentRoute, resolve: router.resolve, push: (loc: Parameters<typeof router.resolve>[0]) => pushed.push(router.resolve(loc).fullPath) },
    target, shellViewLocation, activeSidebarConversation: () => '42', store: { sorted: [] } };
  vm.runInNewContext(code, ctx);
  return pushed.map(path => router.resolve(path));
}
test('deep-link skill selection and input survive core mapping', async () => {
  const [route] = await bridge('/chat', '/tasks?skillIds=1&input=hello+%26+world');
  assert.equal(route.path, '/tasks'); assert.equal(route.query.skillIds, '1'); assert.equal(route.query.input, 'hello & world');
});
test('query-only changes navigate; identical full paths do not', async () => {
  assert.equal((await bridge('/tasks?skillIds=1', '/tasks?skillIds=2'))[0].query.skillIds, '2');
  assert.equal((await bridge('/tasks?skillIds=1', '/tasks?skillIds=1')).length, 0);
});
test('broadcast member mapping preserves its member and other deep-link parameters', async () => {
  const [route] = await bridge('/chat', '/b/group/42?conversationId=99&input=hello#details');
  assert.equal(route.path, '/b/group'); assert.equal(route.query.conversationId, '42');
  assert.equal(route.query.input, 'hello'); assert.equal(route.hash, '#details');
});
test('broadcast selection echo keeps active group view', async () => {
  assert.equal((await bridge('/b/group?conversationId=42', '/c/42')).length, 0);
});
