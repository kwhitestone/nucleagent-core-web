/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `runtime/base/voice-session.js` (vite.config.ts alias).
 * The chat island configures no voice adapter, so a session can never connect and there are never voice transcript
 * messages; every member below behaves as the original does in that state, and the session machinery is left out
 * of the island bundle (180 KiB budget).
 * shortcut: no voice support; drop the alias before passing `adapters.voice` to the runtime.
 */
interface Message { id: string; role: string; status?: { type: string } }
interface Host {
  adapter(): unknown; isRunning(): boolean; getBaseMessages(): readonly Message[];
  markVoiceMessagesDirty(): void; notify(): void;
}

export class VoiceSessionController {
  voiceMessages: Message[] = [];
  voiceGeneration = 0;
  voice: unknown = undefined;
  private readonly host: Host;
  constructor(host: Host) { this.host = host; }
  markMessagesDirty() { this.voiceGeneration++; }
  dropMessage() {}
  getMessages() { return this.host.getBaseMessages(); }
  replaceAssistantMessage() {}
  isVoiceMessage() { return false; }
  getVoiceVolume = () => 0;
  subscribeVoiceVolume = () => () => {};
  isRunActive() {
    if (this.host.isRunning()) return true;
    const last = this.host.getBaseMessages().at(-1);
    return last?.role === "assistant" && (last.status?.type === "running" || last.status?.type === "requires-action");
  }
  getVoiceCommitBarrier() { return undefined; }
  connectVoice() {
    throw new Error(this.host.adapter() ? "Voice is not bundled in this build" : "Voice adapter not configured");
  }
  async appendToVoiceSession() { throw new Error("Cannot send a text message while a voice session is connected"); }
  disconnectVoice() { this.host.markVoiceMessagesDirty(); this.host.notify(); }
  muteVoice() { throw new Error("No active voice session"); }
  unmuteVoice() { throw new Error("No active voice session"); }
}
