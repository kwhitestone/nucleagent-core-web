import type { ReactNode } from "react";

/** Inline stroke icons (no icon library in the island: bundle budget, plan §9). */
export const Icon = ({ d, size = 16 }: { d: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const AssistantMark = () => <Icon size={13} d={<><path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" /><path d="M12 22V12" /><path d="M4 7l8 5 8-5" /></>} />;
export const CopyMark = () => <Icon d={<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>} />;
export const CheckMark = ({ size = 16 }: { size?: number }) => <Icon size={size} d={<path d="M20 6L9 17l-5-5" />} />;
export const ReloadMark = () => <Icon d={<><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></>} />;
export const PlusMark = ({ size = 18 }: { size?: number }) => <Icon size={size} d={<><path d="M12 5v14" /><path d="M5 12h14" /></>} />;
export const SendMark = () => <Icon size={16} d={<><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></>} />;
export const StopMark = () => <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>;
export const ChevronMark = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<path d="M6 9l6 6 6-6" />} />;
export const AlertMark = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>} />;
export const CrossMark = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>} />;
export const ToolMark = ({ size = 12 }: { size?: number }) => <Icon size={size} d={<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.8-3.8a6 6 0 01-7.9 7.9l-6.9 6.9a2.1 2.1 0 01-3-3l6.9-6.9a6 6 0 017.9-7.9l-3.8 3.8z" />} />;

/** One icon per file kind (attachments.ts fileKind): image, sheet, everything else a page. */
const FILE_GLYPH: Record<string, ReactNode> = {
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  sheet: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
  file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></>,
};
export const FileMark = ({ kind, size = 14 }: { kind: string; size?: number }) => <Icon size={size} d={FILE_GLYPH[kind] ?? FILE_GLYPH.file} />;
export const ImageMark = ({ size }: { size?: number }) => <FileMark kind="image" size={size} />;
export const VideoMark = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<><rect x="2" y="5" width="14" height="14" rx="2" /><path d="M22 8l-6 4 6 4V8z" /></>} />;
