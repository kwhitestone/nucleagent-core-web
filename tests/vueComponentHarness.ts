import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compileScript, parse } from "@vue/compiler-sfc";
import ts from "typescript";
import { createRenderer, type Component } from "vue";

export function loadComponent(url: URL): Component {
  const source = readFileSync(url, "utf8");
  const { descriptor } = parse(source, { filename: url.pathname });
  const script = compileScript(descriptor, { id: url.pathname, inlineTemplate: true });
  const code = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as { default: Component } };
  new Function("require", "module", "exports", code)(createRequire(url), module, module.exports);
  return module.exports.default;
}

export type HostNode = {
  tag: string; text: string; props: Record<string, any>; children: HostNode[];
  parent: HostNode | null; focused?: boolean; focus: () => void;
  querySelector: (selector: string) => HostNode | undefined;
  addEventListener: (event: string, listener: EventListener) => void;
};

export function descendants(node: HostNode): HostNode[] {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

export function hostNode(tag: string, text = ""): HostNode {
  const node: HostNode = {
    tag, text, props: {}, children: [], parent: null,
    focus() { node.focused = true; },
    addEventListener(event, listener) { node.props[`listener:${event}`] = listener; },
    querySelector(selector) {
      const group = selector.match(/data-group="([^"]+)"/)?.[1];
      return descendants(node).find(child => child.props.role === "tab" && child.props["data-group"] === group);
    },
  };
  return node;
}

export const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => hostNode(tag),
  createText: text => hostNode("#text", text),
  createComment: text => hostNode("#comment", text),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: (node, key, _previous, next) => { node.props[key] = next; },
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
    node.parent = parent;
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
});
