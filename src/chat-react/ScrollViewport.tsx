import { useLayoutEffect, useRef, type ReactNode, type ComponentProps } from 'react';
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
    const users = () => messages().filter((element) => element.dataset.messageRole === 'user');
    let latestUser = users().at(-1)?.dataset.scrollMessage;
    let userCount = users().length;
    let sentAnchor: HTMLElement | undefined;
    let lastTop = region.scrollTop;
    let appliedTop: number | undefined;
    const spacer = region.querySelector<HTMLElement>('[data-scroll-spacer]')!;
    const capture = () => {
      if (appliedTop === region.scrollTop) { appliedTop = undefined; return; }
      const near = region.scrollHeight - region.clientHeight - region.scrollTop <= 48;
      const following = near || (position.following && region.scrollTop >= lastTop);
      lastTop = region.scrollTop;
      const top = region.getBoundingClientRect().top;
      const anchor = messages().find((element) => element.getBoundingClientRect().bottom > top);
      position = { top: region.scrollTop, following,
        anchor: anchor?.dataset.scrollMessage, offset: anchor ? anchor.getBoundingClientRect().top - top : undefined };
      region.dataset.following = String(following);
      if (conversationId && current()) {
        positions.delete(conversationId);
        positions.set(conversationId, position);
        if (positions.size > 32) positions.delete(positions.keys().next().value!);
      }
    };
    const restore = () => {
      if (!current()) return;
      const rows = users();
      const latest = rows.at(-1);
      if (latest?.dataset.scrollMessage !== latestUser && rows.length > userCount) {
        sentAnchor = latest;
        position.following = true;
      }
      if (sentAnchor && !sentAnchor.isConnected) {
        sentAnchor = rows.length === userCount ? latest : undefined;
        if (position.anchor === latestUser) position.anchor = latest?.dataset.scrollMessage;
        if (!sentAnchor) spacer.style.height = '0px';
      }
      latestUser = latest?.dataset.scrollMessage;
      userCount = rows.length;
      if (sentAnchor?.isConnected) {
        const distance = spacer.getBoundingClientRect().top - sentAnchor.getBoundingClientRect().top;
        const height = `${Math.max(0, region.clientHeight - distance)}px`;
        if (spacer.style.height !== height) spacer.style.height = height;
      }
      const anchor = position.anchor && messages().find((element) => element.dataset.scrollMessage === position.anchor);
      region.scrollTop = position.following ? region.scrollHeight : anchor && position.offset !== undefined
        ? region.scrollTop + anchor.getBoundingClientRect().top - region.getBoundingClientRect().top - position.offset
        : position.top;
      appliedTop = lastTop = region.scrollTop;
      region.dataset.following = String(position.following);
    };
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = undefined; restore(); });
    };
    restore();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observe = () => { resize?.disconnect(); resize?.observe(region); for (const child of region.children) resize?.observe(child); schedule(); };
    const mutation = new MutationObserver(observe);
    mutation.observe(region, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open'] });
    observe();
    region.addEventListener('scroll', capture, { passive: true });
    const bottom = () => { position.following = true; restore(); };
    region.addEventListener('chat-to-latest', bottom);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      region.removeEventListener('scroll', capture);
      region.removeEventListener('chat-to-latest', bottom);
      mutation.disconnect(); resize?.disconnect();
      window.visualViewport?.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [conversationId, ready]);
  return <ThreadPrimitive.Viewport ref={viewport} className={className} autoScroll={false}
    scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} scrollToBottomOnRunStart={false}>
    {children}
    <div data-scroll-spacer="" aria-hidden="true" />
  </ThreadPrimitive.Viewport>;
}

export function ScrollToLatest(props: ComponentProps<'button'>) {
  return <button {...props} type="button" onClick={(event) => {
    event.currentTarget.closest('.mc-root')?.querySelector('.mc-viewport')?.dispatchEvent(new Event('chat-to-latest'));
  }} />;
}
