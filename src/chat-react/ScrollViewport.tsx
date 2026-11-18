import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { SESSION_CHANGE_EVENT, isBusinessBoundaryChange } from '@/contracts/platform-runtime';
import { ThreadPrimitive } from './auiPrimitives';

type Position = { top: number; following: boolean; anchor?: string; offset?: number };
const positions = new Map<string, Position>();
let generation = 0;
if (typeof window !== 'undefined') window.addEventListener(SESSION_CHANGE_EVENT, (event) => {
  if (isBusinessBoundaryChange(event)) { generation++; positions.clear(); }
});

export function ScrollViewport({ conversationId, ready, children, className }: {
  conversationId?: string; ready: boolean; children: ReactNode; className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const region = viewport.current;
    if (!region || !ready) return;
    const owner = generation;
    const current = () => owner === generation;
    let position: Position = conversationId && positions.get(conversationId) || { top: 0, following: true };
    let frame: number | undefined;
    const messages = () => Array.from(region.querySelectorAll<HTMLElement>('[data-scroll-message]'));
    const capture = () => {
      const top = region.getBoundingClientRect().top;
      const anchor = messages().find((element) => element.getBoundingClientRect().bottom > top);
      position = { top: region.scrollTop, following: region.scrollHeight - region.clientHeight - region.scrollTop <= 48,
        anchor: anchor?.dataset.scrollMessage, offset: anchor ? anchor.getBoundingClientRect().top - top : undefined };
      if (conversationId && current()) {
        positions.delete(conversationId);
        positions.set(conversationId, position);
        if (positions.size > 32) positions.delete(positions.keys().next().value!);
      }
    };
    const restore = () => {
      if (!current()) return;
      const anchor = position.anchor && messages().find((element) => element.dataset.scrollMessage === position.anchor);
      region.scrollTop = position.following ? region.scrollHeight : anchor && position.offset !== undefined
        ? region.scrollTop + anchor.getBoundingClientRect().top - region.getBoundingClientRect().top - position.offset
        : position.top;
    };
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = undefined; restore(); });
    };
    restore();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observe = () => { resize?.disconnect(); resize?.observe(region); for (const child of region.children) resize?.observe(child); schedule(); };
    const mutation = new MutationObserver(observe);
    mutation.observe(region, { childList: true, subtree: true, characterData: true });
    observe();
    region.addEventListener('scroll', capture, { passive: true });
    return () => {
      region.removeEventListener('scroll', capture);
      mutation.disconnect(); resize?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [conversationId, ready]);
  return <ThreadPrimitive.Viewport ref={viewport} className={className} autoScroll={false}
    scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} scrollToBottomOnRunStart={false}>
    {children}
  </ThreadPrimitive.Viewport>;
}
