import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from '@/contracts/platform-runtime';
import { followUp } from '@/addons/conversation/api/conversation';
import type { Conversation } from '@/addons/conversation/api/types';
import { toast } from '@/composables/useToast';
import { createMessageActions, type Question, type BranchMode } from './messageActions';
import { messageActionsApi } from './messageActionsApi';
import type { Translate } from './ChatApp';
import { Icon, ReloadMark } from './icons';

export function useMessageActions(id: string | undefined, running: boolean, navigate: (path: string) => void, created: (conversation: Conversation) => void, report: (error: Error) => void) {
  const [, render] = useState(0);
  const [epoch, reset] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const live = useRef({ id, running, navigate, created });
  live.current = { id, running, navigate, created };
  const actions = useMemo(() => {
    if (!id) return undefined;
    const version = getPlatformRuntime().getSessionVersion();
    return createMessageActions({ ...messageActionsApi(id),
      isCurrent: () => mounted.current && live.current.id === id && version === getPlatformRuntime().getSessionVersion() && !!getPlatformRuntime().getAccessToken() && !getPlatformRuntime().useEmbeddedAuthorization().revalidating?.value,
      isRunning: () => live.current.running,
      send: (forkId, content, attachments) => followUp(forkId, content, attachments),
      navigate: (forkId) => live.current.navigate(`/c/${forkId}`), created: (fork) => live.current.created(fork),
    }, () => render((value) => value + 1));
  }, [id, epoch]);
  useEffect(() => {
    let active = true;
    void actions?.load().catch((error: Error) => { if (active) report(error); });
    const renew = () => reset((value) => value + 1);
    window.addEventListener(SESSION_CHANGE_EVENT, renew);
    return () => { active = false; window.removeEventListener(SESSION_CHANGE_EVENT, renew); };
  }, [actions, report]);
  return actions;
}

export type MessageActionsController = ReturnType<typeof useMessageActions>;
export function MessageActions({ actions, t, isUser, copy }: { actions: MessageActionsController; t: Translate; isUser: boolean; copy: ReactNode }) {
  const metadata = useAuiState((state) => state.message.metadata.custom) as { question?: Question; feedbackMessageId?: number };
  const running = useAuiState((state) => state.thread.isRunning);
  const [editing, edit] = useState(false);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [details, showDetails] = useState(false);
  const question = metadata.question;
  const messageId = metadata.feedbackMessageId;
  const feedback = messageId ? actions?.feedback.get(messageId) : undefined;
  const disabled = !actions || !actions.loaded || actions.busy || running;
  const perform = async (work: () => Promise<void>, done?: () => void) => {
    try { await work(); if (actions?.isCurrent()) done?.(); } catch { if (actions?.isCurrent()) toast.error(t('common.operationFailed')); }
  };
  const branch = (mode: BranchMode, content?: string) => { if (question && actions) void perform(() => actions.branch(question, mode, content), () => edit(false)); };
  const button = (label: string, glyph: ReactNode, click: () => void, pressed?: boolean) => <button type="button" className="mc-icon-btn" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={click}>{glyph}</button>;
  return <>
    {isUser && question && button(t('chatReact.edit'), <Icon d={<path d="m16 3 5 5-12 12H4v-5ZM14 5l5 5" />} />, () => { setDraft(question.content); edit(true); })}
    {copy}
    {isUser && question && button(t('chatReact.fork'), <Icon d={<><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10m12-10a8 8 0 0 1-8 8H6" /></>} />, () => branch('fork'))}
    {!isUser && messageId && <>
      {button(t('chatReact.good'), <Thumb />, () => { void perform(() => actions!.vote(messageId, 1), () => showDetails(false)); }, feedback?.rating === 1)}
      {button(t('chatReact.bad'), <Thumb down />, () => { void perform(() => actions!.vote(messageId, -1), () => { setReason(''); setComment(''); showDetails(actions?.feedback.get(messageId)?.rating === -1); }); }, feedback?.rating === -1)}
      {feedback?.rating === -1 && button(t('chatReact.feedbackDetails'), '…', () => { setReason(feedback.reason); setComment(feedback.comment); showDetails(!details); })}
    </>}
    {!isUser && question && button(t('chatReact.reload'), <ReloadMark />, () => branch('send'))}
    {editing && <div className="mc-message-form">
      <textarea autoFocus aria-label={t('chatReact.edit')} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') edit(false);
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!disabled && (draft.trim() || question?.attachments?.length)) branch('send', draft); }
      }} />
      <button type="button" disabled={disabled} onClick={() => edit(false)}>{t('common.cancel')}</button>
      <button type="button" disabled={disabled || (!draft.trim() && !question?.attachments?.length)} onClick={() => branch('save', draft)}>{t('chatReact.save')}</button>
      <button type="button" disabled={disabled || (!draft.trim() && !question?.attachments?.length)} onClick={() => branch('send', draft)}>{t('chatReact.send')}</button>
    </div>}
    {details && feedback?.rating === -1 && messageId && <div className="mc-message-form">
      <div role="group" aria-label={t('chatReact.feedbackDetails')} className="mc-feedback-reasons">
        {['dont_like_the_style', 'too_verbose', 'not_helpful', 'not_factually_correct', 'didnt_fully_follow_instructions', 'refused_when_it_shouldnt_have', 'being_lazy', 'other'].map((value) => <button type="button" key={value} disabled={disabled} aria-pressed={reason === value} onClick={() => setReason(reason === value ? '' : value)}>{t(`chatReact.${value}`)}</button>)}
      </div>
      <textarea aria-label={t('chatReact.feedbackDetails')} maxLength={2000} value={comment} disabled={disabled} onChange={(event) => setComment(event.target.value)} />
      <button type="button" disabled={disabled} onClick={() => showDetails(false)}>{t('common.cancel')}</button>
      <button type="button" disabled={disabled} onClick={() => { void perform(() => actions!.details(messageId, reason, comment), () => showDetails(false)); }}>{t('chatReact.save')}</button>
    </div>}
  </>;
}

function Thumb({ down = false }: { down?: boolean }) {
  return <Icon d={<g transform={down ? 'rotate(180 12 12)' : undefined}><path d="M7 10v12H3V10zm0 0 5-8c2 0 3 2 2 5l-1 3h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7" /></g>} />;
}
