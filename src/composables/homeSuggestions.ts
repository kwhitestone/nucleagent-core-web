/**
 * Home suggestion cards (UNI-T14): the built-in icon library, response parsing for the home page and the admin's validation rules
 * (same rules as Core's PUT, so an imported JSON is checked before saving).
 *
 * Icons are bundled components only: no upload, URL or SVG text. Ids are the
 * Core whitelist (shared model.HomeSuggestionIcons); the 9 legacy ids keep
 * their original strokes. Everything else is a tree-shaken Lucide (ISC) icon.
 */
import type { Component } from "vue";
import {
  createLucideIcon,
  Award, BadgePercent, Book, BookOpen, Bot, Braces, Brain, Briefcase, Brush, Bug, Calculator, Calendar, Camera,
  ChartColumn, ChartPie, ClipboardList, Code, Coffee, Cpu, Database, Dumbbell, FlaskConical, Folder, Gauge, Gift,
  GitBranch, Globe, GraduationCap, Handshake, Heart, House, Image, Languages, LayoutDashboard, Library, Lightbulb,
  ListTodo, Mail, MapPin, Megaphone, Mic, Newspaper, NotebookPen, Palette, PenLine, PenTool, Plane, Puzzle, Quote,
  Rocket, School, ScrollText, Search, Server, Shapes, Share2, Sheet, ShoppingCart, Sparkles, Star, Store, Sun,
  Table, Tag, Target, Terminal, TrendingUp, Users, Utensils, Workflow, Zap,
} from "@lucide/vue";

type Node = [string, Record<string, string>][];
const legacy = (name: string, node: Node): Component =>
  createLucideIcon({ name, node: node.map(([tag, attrs], i) => [tag, { ...attrs, key: String(i) }]) } as never);

const PALETTE = {
  teal: ["var(--teal-50)", "var(--teal-600)"],
  amber: ["#fef3c7", "#d97706"],
  indigo: ["#e0e7ff", "var(--indigo-500)"],
  rose: ["#ffe4e6", "#e11d48"],
  violet: ["#ede9fe", "#7c3aed"],
} as const;
type Palette = keyof typeof PALETTE;

export const ICON_CATEGORIES = ["classic", "general", "office", "data", "writing", "code", "design", "media", "marketing", "education", "life"] as const;
export type IconCategory = (typeof ICON_CATEGORIES)[number];

export interface HomeIcon {
  id: string;
  category: IconCategory;
  /** Chinese name, for search and the picker's tooltip. */
  label: string;
  component: Component;
  bg: string;
  color: string;
}

const CATEGORY_PALETTE: Record<IconCategory, Palette> = {
  classic: "teal", general: "indigo", office: "amber", data: "teal", writing: "indigo", code: "violet",
  design: "rose", media: "rose", marketing: "amber", education: "teal", life: "rose",
};

// [id, category, label, component, palette override]
const TABLE: [string, IconCategory, string, Component, Palette?][] = [
  ["check", "classic", "勾选", legacy("check", [["path", { d: "M9 11l3 3L22 4" }], ["path", { d: "M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" }]]), "teal"],
  ["ppt", "classic", "演示", legacy("ppt", [["rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }], ["line", { x1: "8", y1: "21", x2: "16", y2: "21" }], ["line", { x1: "12", y1: "17", x2: "12", y2: "21" }]]), "amber"],
  ["chat", "classic", "对话", legacy("chat", [["path", { d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" }]]), "indigo"],
  ["video", "classic", "视频", legacy("video", [["polygon", { points: "23 7 16 12 23 17 23 7" }], ["rect", { x: "1", y: "5", width: "15", height: "14", rx: "2" }]]), "rose"],
  ["music", "classic", "音乐", legacy("music", [["path", { d: "M9 18V5l12-2v13" }], ["circle", { cx: "6", cy: "18", r: "3" }], ["circle", { cx: "18", cy: "16", r: "3" }]]), "violet"],
  ["chart", "classic", "折线图", legacy("chart", [["path", { d: "M3 3v18h18" }], ["path", { d: "M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" }]]), "teal"],
  ["doc", "classic", "文档", legacy("doc", [["path", { d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" }], ["polyline", { points: "14 2 14 8 20 8" }], ["line", { x1: "16", y1: "13", x2: "8", y2: "13" }], ["line", { x1: "16", y1: "17", x2: "8", y2: "17" }]]), "indigo"],
  ["clock", "classic", "时钟", legacy("clock", [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 6v6l4 2" }]]), "amber"],
  ["layers", "classic", "图层", legacy("layers", [["path", { d: "M12 2L2 7l10 5 10-5-10-5z" }], ["path", { d: "M2 17l10 5 10-5" }], ["path", { d: "M2 12l10 5 10-5" }]]), "teal"],
  ["star", "general", "星标", Star], ["sparkles", "general", "灵感", Sparkles], ["lightbulb", "general", "想法", Lightbulb],
  ["zap", "general", "快速", Zap], ["search", "general", "搜索", Search], ["bot", "general", "机器人", Bot], ["rocket", "general", "启动", Rocket],
  ["mail", "office", "邮件", Mail], ["calendar", "office", "日程", Calendar], ["briefcase", "office", "工作", Briefcase],
  ["clipboard-list", "office", "清单", ClipboardList], ["folder", "office", "文件夹", Folder], ["list-todo", "office", "待办", ListTodo],
  ["users", "office", "团队", Users],
  ["chart-column", "data", "柱状图", ChartColumn], ["chart-pie", "data", "饼图", ChartPie], ["trending-up", "data", "增长", TrendingUp],
  ["database", "data", "数据库", Database], ["table", "data", "表格", Table], ["calculator", "data", "计算", Calculator],
  ["gauge", "data", "仪表盘", Gauge], ["sheet", "data", "电子表格", Sheet],
  ["pen-line", "writing", "写作", PenLine], ["notebook-pen", "writing", "笔记", NotebookPen], ["book-open", "writing", "阅读", BookOpen],
  ["quote", "writing", "引用", Quote], ["languages", "writing", "翻译", Languages], ["newspaper", "writing", "新闻", Newspaper],
  ["scroll-text", "writing", "长文", ScrollText],
  ["code", "code", "代码", Code], ["terminal", "code", "终端", Terminal], ["bug", "code", "调试", Bug], ["git-branch", "code", "分支", GitBranch],
  ["braces", "code", "JSON", Braces], ["server", "code", "服务器", Server], ["cpu", "code", "芯片", Cpu], ["workflow", "code", "流程", Workflow],
  ["puzzle", "code", "插件", Puzzle],
  ["palette", "design", "配色", Palette], ["pen-tool", "design", "钢笔工具", PenTool], ["brush", "design", "画笔", Brush],
  ["shapes", "design", "图形", Shapes], ["layout-dashboard", "design", "布局", LayoutDashboard],
  ["mic", "media", "录音", Mic], ["camera", "media", "拍摄", Camera], ["image", "media", "图片", Image],
  ["megaphone", "marketing", "推广", Megaphone], ["target", "marketing", "目标", Target], ["shopping-cart", "marketing", "购物", ShoppingCart],
  ["tag", "marketing", "标签", Tag], ["handshake", "marketing", "合作", Handshake], ["share-2", "marketing", "分享", Share2],
  ["badge-percent", "marketing", "优惠", BadgePercent], ["store", "marketing", "店铺", Store],
  ["graduation-cap", "education", "学位", GraduationCap], ["school", "education", "学校", School], ["book", "education", "书籍", Book],
  ["brain", "education", "思考", Brain], ["flask-conical", "education", "实验", FlaskConical], ["globe", "education", "全球", Globe],
  ["library", "education", "图书馆", Library], ["award", "education", "奖项", Award],
  ["heart", "life", "健康", Heart], ["coffee", "life", "咖啡", Coffee], ["plane", "life", "旅行", Plane], ["map-pin", "life", "地点", MapPin],
  ["utensils", "life", "美食", Utensils], ["dumbbell", "life", "运动", Dumbbell], ["house", "life", "家居", House], ["sun", "life", "天气", Sun],
  ["gift", "life", "礼物", Gift],
];

export const HOME_ICONS: HomeIcon[] = TABLE.map(([id, category, label, component, palette]) => {
  const [bg, color] = PALETTE[palette ?? CATEGORY_PALETTE[category]];
  return { id, category, label, component, bg, color };
});
const BY_ID = new Map(HOME_ICONS.map((icon) => [icon.id, icon]));
export const DEFAULT_ICON = "layers";

/** Unknown ids (a newer Core than this bundle) render as layers, never an error. */
export function iconFor(id: string): HomeIcon {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ICON)!;
}

export function searchIcons(category: IconCategory | "all", query: string): HomeIcon[] {
  const q = query.trim().toLowerCase();
  return HOME_ICONS.filter((icon) => (category === "all" || icon.category === category)
    && (!q || icon.id.includes(q) || icon.label.includes(q)));
}

// ---- cards ----

export type HomeAction = "fill-title" | "prefill";
export const MAX_CARDS = 12;

/** One card as stored and edited (Core's flat columns). Empty en = use zh. */
export interface HomeSuggestionItem {
  id: string;
  enabled: boolean;
  icon: string;
  action: HomeAction;
  titleZh: string;
  descZh: string;
  promptZh: string;
  titleEn: string;
  descEn: string;
  promptEn: string;
}

/** A card resolved for one locale, ready to render. */
export interface HomeCard {
  id: string;
  icon: string;
  action: HomeAction;
  title: string;
  desc: string;
  prompt: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Coerces one untrusted object into an item; null when it has no id or zh title. */
export function normalizeItem(raw: unknown): HomeSuggestionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const item: HomeSuggestionItem = {
    id: str(r.id), enabled: r.enabled !== false, icon: str(r.icon),
    action: r.action === "prefill" ? "prefill" : "fill-title",
    titleZh: str(r.titleZh), descZh: str(r.descZh), promptZh: str(r.promptZh),
    titleEn: str(r.titleEn), descEn: str(r.descEn), promptEn: str(r.promptEn),
  };
  return item.id && item.titleZh ? item : null;
}

export function localize(item: HomeSuggestionItem, locale: string): HomeCard {
  const en = locale.startsWith("en");
  return {
    id: item.id, icon: BY_ID.has(item.icon) ? item.icon : DEFAULT_ICON, action: item.action,
    title: (en && item.titleEn) || item.titleZh,
    desc: (en && item.descEn) || item.descZh,
    prompt: (en && item.promptEn) || item.promptZh,
  };
}

/**
 * The user GET's data → cards for this locale. Core is the only source (UNI-C7):
 * null data, a wrong shape or nothing valid left is an empty list, which the
 * home shows as an explicit empty state. Bad items are skipped one by one.
 */
export function resolveCards(data: unknown, locale: string): HomeCard[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.map(normalizeItem).filter((i): i is HomeSuggestionItem => !!i && i.enabled)
    .slice(0, MAX_CARDS).map((i) => localize(i, locale));
}

/** What a click puts in the composer. Never sends. */
export function cardInput(card: HomeCard): string {
  return card.action === "prefill" && card.prompt ? card.prompt : `${card.title}：`;
}

// ---- admin validation (mirrors Core PUT) ----

export type InvalidReason = "required" | "tooLong" | "control" | "icon" | "action" | "id" | "duplicate";
export interface Invalid {
  /** -1 = the list as a whole. */
  index: number;
  field: string;
  reason: InvalidReason | "count" | "noneEnabled";
}

/** Same rune limits as Core PUT. The verbatim seed English runs to 20/43, so 20/40 was too tight. */
export const LIMITS = { title: 40, desc: 80, prompt: 2000 } as const;
const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const CONTROL_OR_NEWLINE = /[\u0000-\u001f\u007f]/;

function textError(value: string, max: number, required: boolean, multiline: boolean): InvalidReason | null {
  const v = value.trim();
  if (required && !v) return "required";
  if ([...v].length > max) return "tooLong";
  if ((multiline ? CONTROL : CONTROL_OR_NEWLINE).test(v)) return "control";
  return null;
}

export function validateItems(items: HomeSuggestionItem[]): Invalid | null {
  if (items.length < 1 || items.length > MAX_CARDS) return { index: -1, field: "items", reason: "count" };
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!ID_PATTERN.test(item.id)) return { index, field: "id", reason: "id" };
    const key = item.id.toLowerCase();
    if (seen.has(key)) return { index, field: "id", reason: "duplicate" };
    seen.add(key);
    if (!BY_ID.has(item.icon)) return { index, field: "icon", reason: "icon" };
    if (item.action !== "fill-title" && item.action !== "prefill") return { index, field: "action", reason: "action" };
    const fields: [keyof HomeSuggestionItem, number, boolean, boolean][] = [
      ["titleZh", LIMITS.title, true, false], ["descZh", LIMITS.desc, false, false], ["promptZh", LIMITS.prompt, false, true],
      ["titleEn", LIMITS.title, false, false], ["descEn", LIMITS.desc, false, false], ["promptEn", LIMITS.prompt, false, true],
    ];
    for (const [field, max, required, multiline] of fields) {
      const reason = textError(String(item[field]), max, required, multiline);
      if (reason) return { index, field, reason };
    }
  }
  if (!items.some((item) => item.enabled)) return { index: -1, field: "enabled", reason: "noneEnabled" };
  return null;
}

/** Export/import format: the editable fields only, so it pastes into any environment. */
export function exportJSON(items: HomeSuggestionItem[]): string {
  return JSON.stringify({ version: 1, items }, null, 2);
}

/** Accepts the export format (or a bare array / an admin GET envelope). Throws on junk. */
export function parseImport(text: string): HomeSuggestionItem[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed
    : (parsed as { items?: unknown })?.items ?? (parsed as { data?: { items?: unknown } })?.data?.items;
  if (!Array.isArray(list)) throw new Error("no items array");
  return list.map((raw, i) => {
    const item = normalizeItem(raw);
    if (!item) throw new Error(`item ${i + 1} has no id or Chinese title`);
    item.action = str((raw as Record<string, unknown>).action) as HomeAction; // validation, not coercion, judges it
    return item;
  });
}
