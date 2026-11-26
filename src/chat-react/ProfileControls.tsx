import { CheckMark } from "./icons";
import { cap } from "./requestEffort";
import type { ProfileRow } from "./useModelPreference";
import type { Translate } from "./ChatApp";

/**
 * design-1123 A: the preset radios the 「思考」 pill opens (exp104 S1/S3 kept: choosing saves at once, saving disables the
 * group with a spinner, a failed save says what the server kept).
 * MUYU-365 p0c40 v2 (user 2026-11-26): only 快速（低） / 深度思考（高）, with their real mapped level; Core's off/default (and any
 * other) rows are not shown and nothing is made up. A disabled tier says Core's reason on its own line. A saved id that is
 * not listed highlights nothing (never replaced for the user). `stale` = the current preset no longer fits the model.
 */
export const TIERS = ["quick", "thinking"];
/** Tier label with the row's real level, e.g. 深度思考（中） when Core maps it to medium. */
export const tierName = (row: ProfileRow, t: Translate) => {
  const level = row.params?.thinkingLevel || row.params?.reasoningEffort;
  return t(`chatReact.tier_${row.id}`) + (level ? `（${t(`chatReact.effort${cap(level)}`)}）` : "");
};
export default function ProfileControls({ t, rows, selected, saving, rolledBack, error, stale, staleReason, onChange, onRetry }: {
  t: Translate; rows: ProfileRow[]; selected: string; saving: boolean; rolledBack: boolean; error: boolean; stale?: string; staleReason?: string;
  onChange(profileId: string): void; onRetry(): void;
}) {
  const why = (row: ProfileRow) => row.reason || t("chatReact.optionUnavailable");
  const listed = TIERS.flatMap((id) => rows.filter((row) => row.id === id));
  return <div role="group" aria-label={t("chatReact.profile")} aria-busy={saving} className="mc-preset">
    <div className="mc-menu-label">{t("chatReact.profile")}{saving && <span className="mc-busy" data-testid="mc-profile-saving" role="status" aria-label={t("chatReact.saving")} />}</div>
    {stale && !error && <p className="mc-notice" role="status" data-testid="mc-preset-stale">{t("chatReact.presetStale").replace("{name}", stale)}{staleReason ?? ""}</p>}
    {error ? <>
      <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileError")}</p>
      <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid="mc-profile-retry" onClick={onRetry}>{t("common.retry")}</button>
    </> : listed.map((row) =>
      <button key={row.id} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
        aria-checked={selected === row.id} disabled={saving || !row.enabled} title={row.enabled ? undefined : why(row)}
        onClick={() => { if (row.id !== selected) onChange(row.id); }}>
        <span className="mc-menu-text">{tierName(row, t)}</span>
        {selected === row.id && <CheckMark size={14} />}
        {!row.enabled && <span className="mc-menu-sub" data-testid="mc-preset-reason">{why(row)}</span>}
      </button>)}
    {rolledBack && <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileRolledBack")}</p>}
    <p className="mc-menu-label">{t("chatReact.profileNote")}</p>
  </div>;
}
