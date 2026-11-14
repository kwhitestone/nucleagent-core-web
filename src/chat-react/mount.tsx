import { createRoot } from "react-dom/client";
import { ChatApp, type ChatProps } from "./ChatApp";
import type { IslandStrings } from "./islandStringsZh";
import { preloadChatStrategy } from "./chatStrategy";

export type MountProps = Omit<ChatProps, "strings">;

/** Only the current language's island strings are downloaded (each is its own chunk; ChatHost.vue starts it early). */
export const loadIslandStrings = (locale: ChatProps["locale"]): Promise<IslandStrings> =>
  locale === "en-US" ? import("./islandStringsEn").then((m) => m.EN_STRINGS) : import("./islandStringsZh").then((m) => m.ZH_STRINGS);

/** Entry of the lazily loaded React chunk; ChatHost.vue owns the element and lifecycle. */
export function mount(element: HTMLElement, props: MountProps) {
  void preloadChatStrategy(window.location.origin);
  const root = createRoot(element);
  let latest = 0;
  let dead = false;
  // A newer update or unmount wins over a strings load still in flight.
  const render = (next: MountProps) => {
    const n = ++latest;
    // shortcut: if the strings chunk fails to load, island labels show their keys; add a retry if that is seen in practice.
    void loadIslandStrings(next.locale).catch(() => ({}) as IslandStrings).then((strings) => {
      if (!dead && n === latest) root.render(<ChatApp {...next} strings={strings} />);
    });
  };
  render(props);
  return {
    update: render,
    unmount: () => { dead = true; root.unmount(); },
  };
}
