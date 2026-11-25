import { CheckMark } from "./icons";
import { cap } from "./requestEffort";
import type { ProfileRow } from "./useModelPreference";
import type { Translate } from "./ChatApp";

/**
 * design-1123 A: the preset radios the 「思考」 pill opens (exp104 S1/S3 kept: choosing saves at once, saving disables the
 * group with a spinner, a failed save says what the server kept). Each preset names the thinking level.
 * MUYU-365 thinking3: a chat catalog always lists the three tiers 关闭思考 / 快速（低） / 深度思考（高） in that order, each
 * with its real mapped level; a tier Core does not enable stays listed, disabled, with Core's reason. Core has no `off`
 * row yet, so 关闭思考 is listed disabled saying so (默认 is never shown as 关闭). Other disabled rows are listed only when
 * current (kept, never silently swapped). `stale` = the current preset's protocol/level no longer fits the model.
 */
const TIERS = ["off", "quick", "thinking"];
/** Tier label with the row's real level, e.g. 深度思考（中） when Core maps it to medium; other ids keep Core's name. */
export const tierName = (row: ProfileRow, t: Translate) => {
  const level = row.params?.thinkingLevel || row.params?.reasoningEffort;
  return TIERS.includes(row.id) ? t(`chatReact.tier_${row.id}`) + (level && level !== "off" ? `（${t(`chatReact.effort${cap(level)}`)}）` : "") : row.displayName || row.id;
};
export default function ProfileControls({ t, rows, selected, saving, rolledBack, error, stale, staleReason, onChange, onRetry }: {
  t: Translate; rows: ProfileRow[]; selected: string; saving: boolean; rolledBack: boolean; error: boolean; stale?: string; staleReason?: string;
  onChange(profileId: string): void; onRetry(): void;
}) {
  const detail = (row: ProfileRow) => {
    const level = row.params?.thinkingLevel || row.params?.reasoningEffort;
    return level ? `${t("chatReact.effort")} ${t(`chatReact.effort${cap(level)}`)}` : t("chatReact.effortDefault");
  };
  // MUYU-365 GAP G-3: a disabled row says Core's own reason (model_profile.go `reason`), else 暂未开放.
  const why = (row: ProfileRow) => row.reason || t("chatReact.optionUnavailable");
  const chat = rows.some((row) => TIERS.includes(row.id));
  const off = rows.find((row) => row.id === "off") ?? { id: "off", enabled: false, reason: t("chatReact.tierOffMissing") } as ProfileRow;
  const listed = [...(chat ? [off] : []), ...rows.filter((row) => row.id !== "default" && row.id !== "off" && (row.enabled || row.id === selected || TIERS.includes(row.id)))]
    .sort((a, b) => TIERS.indexOf(a.id) + 9 * +!TIERS.includes(a.id) - TIERS.indexOf(b.id) - 9 * +!TIERS.includes(b.id));
  const fallback = rows.find(row => row.id === "default") ?? { id: "", enabled: true } as ProfileRow;
  const checked = selected || fallback.id;
  return <div role="group" aria-label={t("chatReact.profile")} aria-busy={saving} className="mc-preset">
    <div className="mc-menu-label">{t("chatReact.profile")}{saving && <span className="mc-busy" data-testid="mc-profile-saving" role="status" aria-label={t("chatReact.saving")} />}</div>
    {stale && !error && <p className="mc-notice" role="status" data-testid="mc-preset-stale">{t("chatReact.presetStale").replace("{name}", stale)}{staleReason ?? ""}</p>}
    {error ? <>
      <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileError")}</p>
      <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid="mc-profile-retry" onClick={onRetry}>{t("common.retry")}</button>
    </> : [fallback, ...listed].map((row) =>
      <button key={row.id} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
        aria-checked={checked === row.id} disabled={saving || !row.enabled} title={row.enabled ? undefined : why(row)}
        onClick={() => { if (row.id !== checked) onChange(row.id); }}>
        <span className="mc-menu-text">{row.id ? tierName(row, t) : t("chatReact.selectionDefault")}{row.enabled ? "" : `（${why(row)}）`}</span>
        {checked === row.id && <CheckMark size={14} />}
        {row.id && !TIERS.includes(row.id) && <span className="mc-menu-sub" data-testid="mc-preset-detail">{detail(row)}</span>}
      </button>)}
    {rolledBack && <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileRolledBack")}</p>}
    <p className="mc-menu-label">{t("chatReact.profileNote")}</p>
  </div>;
}
