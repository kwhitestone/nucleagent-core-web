import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { h, nextTick, ref } from "vue";
import { descendants, hostNode, loadComponent, renderer } from "./vueComponentHarness.ts";
import { groups } from "../src/addons/administration/agents/definition/groups.ts";

const Sidebar = loadComponent(new URL("../src/components/agent-edit/EditSidebar.vue", import.meta.url));

test("shared sidebar renders the full admin order, selection and dirty marker", () => {
  const root = hostNode("root");
  const app = renderer.createApp(Sidebar, {
    groups: groups.map(id => ({ id, label: id, dirty: id === "model" })),
    active: "basic", ariaLabel: "Editor", dirtyLabel: "Unsaved",
  });
  app.mount(root);
  const nodes = descendants(root);
  const tabs = nodes.filter(node => node.props.role === "tab");
  assert.deepEqual(tabs.map(node => node.props["data-group"]), groups);
  assert.deepEqual(tabs.map(node => node.props.tabindex), [0, -1, -1, -1, -1, -1, -1]);
  assert.equal(tabs[0].props["aria-selected"], true);
  assert.equal(nodes.filter(node => node.props["aria-label"] === "Unsaved").length, 1);
  app.unmount();
});

test("shared sidebar respects the caller subset and navigates by click and arrow keys", async () => {
  const root = hostNode("root"), active = ref("basic");
  const subset = ["basic", "persona", "model", "skills"];
  const app = renderer.createApp({ setup: () => () => h(Sidebar, {
    groups: subset.map(id => ({ id, label: id })), active: active.value, ariaLabel: "Editor",
    onSelect: (id: string) => { active.value = id; },
  }) });
  app.mount(root);
  const tabs = () => descendants(root).filter(node => node.props.role === "tab");
  const nav = descendants(root).find(node => node.props.role === "tablist")!;
  assert.deepEqual(tabs().map(node => node.props["data-group"]), subset);
  tabs()[2].props.onClick();
  await nextTick();
  assert.equal(active.value, "model");
  let prevented = 0;
  for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    nav.props.onKeydown({ key, preventDefault() { prevented++; } });
    await nextTick();
    await nextTick();
    assert.equal(tabs().find(node => node.props["data-group"] === active.value)?.focused, true);
  }
  assert.equal(active.value, "model");
  assert.equal(prevented, 4);
  nav.props.onKeydown({ key: "Tab", preventDefault() { throw Error("Tab must retain native focus behavior"); } });
  app.unmount();
});

test("admin drawer imports shared navigation and keeps group ownership", () => {
  const drawer = readFileSync(new URL("../src/addons/administration/agents/definition/DefinitionDrawer.vue", import.meta.url), "utf8");
  assert.match(drawer, /import EditSidebar from ".*components\/agent-edit\/EditSidebar.vue"/);
  assert.match(drawer, /<EditSidebar[^>]+@select="goTo"/);
  assert.doesNotMatch(drawer, /function onNavKey|<nav class="group-nav"/);
  assert.match(drawer, /groups\.map\(id =>/);
});
