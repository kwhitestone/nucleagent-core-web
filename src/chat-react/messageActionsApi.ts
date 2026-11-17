import { getPlatformRuntime } from '@/contracts/platform-runtime';
import type { Feedback } from './messageActions';
import type { Conversation } from '@/addons/conversation/api/types';

const base = '/api/v1/addons/conversation';
export const messageActionsApi = (id: string) => ({
  async list(): Promise<Feedback[]> {
    return (await getPlatformRuntime().http.get<{ data: Feedback[] }>(`${base}/${id}/feedback`)).data.data;
  },
  async set(messageId: number, value: Omit<Feedback, 'messageId'>): Promise<Feedback> {
    return (await getPlatformRuntime().http.put<{ data: Feedback }>(`${base}/${id}/messages/${messageId}/feedback`, value)).data.data;
  },
  async clear(messageId: number): Promise<void> {
    await getPlatformRuntime().http.delete(`${base}/${id}/messages/${messageId}/feedback`);
  },
  async fork(messageId: number, before: boolean, content?: string): Promise<Conversation> {
    return (await getPlatformRuntime().http.post<{ data: Conversation }>(`${base}/${id}/fork`, { messageId, before, ...(content !== undefined ? { content } : {}) })).data.data;
  },
});
