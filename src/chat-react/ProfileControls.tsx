import { CheckMark } from "./icons";
import { cap } from "./requestEffort";
import type { ProfileRow } from "./useModelPreference";
import type { Translate } from "./ChatApp";

/**
 * design-1123 A: the preset radios the 「思考」 pill opens (exp104 S1/S3 kept: choosing saves at once, saving disables the
 * group with a spinner, a failed save says what the server kept). Each preset shows one line 「思考强度 X · 协议」.
 * A disabled preset is not listed unless it is the current one (kept, never silently swapped). `stale` = the current
 * preset's protocol/level no longer fits the model: said on top, the turn goes out with 默认（继承） protocol/level.
 */
export default function ProfileControls({ t, rows, selected, saving, rolledBack, error, stale, onChange, onRetry }: {
  t: Translate; rows: ProfileRow[]; selected: string; saving: boolean; rolledBack: boolean; error: boolean; stale?: string;
  onChange(profileId: string): void; onRetry(): void;
}) {
  const detail = (row: ProfileRow) => {
    const level = row.params?.thinkingLevel || row.params?.reasoningEffort;
    return `${level ? `${t("chatReact.effort")} ${t(`chatReact.effort${cap(level)}`)}` : t("chatReact.effortDefault")} · ${row.params?.callProtocol || t("chatReact.presetProtocolDefault")}`;
  };
  const listed = rows.filter((row) => row.enabled || row.id === selected);
  return <div role="group" aria-label={t("chatReact.profile")} aria-busy={saving} className="mc-preset">
    <div className="mc-menu-label">{t("chatReact.profile")}{saving && <span className="mc-busy" data-testid="mc-profile-saving" role="status" aria-label={t("chatReact.saving")} />}</div>
    {stale && !error && <p className="mc-notice" role="status" data-testid="mc-preset-stale">{t("chatReact.presetStale").replace("{name}", stale)}</p>}
    {error ? <>
      <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileError")}</p>
      <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid="mc-profile-retry" onClick={onRetry}>{t("common.retry")}</button>
    </> : [{ id: "", enabled: true } as ProfileRow, ...listed].map((row) =>
      <button key={row.id} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
        aria-checked={selected === row.id} disabled={saving || !row.enabled} title={row.enabled ? undefined : t("chatReact.optionUnavailable")}
        onClick={() => { if (row.id !== selected) onChange(row.id); }}>
        <span className="mc-menu-text">{row.id ? row.displayName || row.id : t("chatReact.selectionDefault")}{row.enabled ? "" : `（${t("chatReact.optionUnavailable")}）`}</span>
        {selected === row.id && <CheckMark size={14} />}
        {row.id && <span className="mc-menu-sub" data-testid="mc-preset-detail">{detail(row)}</span>}
      </button>)}
    {rolledBack && <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileRolledBack")}</p>}
    <p className="mc-menu-label">{t("chatReact.profileNote")}</p>
  </div>;
}
