import { CheckMark } from "./icons";
import { cap } from "./requestEffort";
import type { ProfileRow } from "./useModelPreference";
import type { Translate } from "./ChatApp";

/**
 * MUYU-365 exp104: the 「预设」 page of the Controls menu (design D2A/D4A, S1–S7). Choosing saves at once (S1); while
 * saving the group is disabled with a spinner; a failed save shows the server's kept choice and says so (S3).
 * Read-only: the selected preset gets one line of what it changes, no parameter editing (D4A).
 */
export default function ProfileControls({ t, rows, selected, saving, rolledBack, error, outside, onChange, onRetry }: {
  t: Translate; rows: ProfileRow[]; selected: string; saving: boolean; rolledBack: boolean; error: boolean; outside: boolean;
  onChange(profileId: string): void; onRetry(): void;
}) {
  const effort = (row: ProfileRow) => row.params?.reasoningEffort;
  return <div role="group" aria-label={t("chatReact.profile")} aria-busy={saving}>
    <div className="mc-menu-label">{t("chatReact.profile")}{saving && <span className="mc-busy" data-testid="mc-profile-saving" role="status" aria-label={t("chatReact.saving")} />}</div>
    {error ? <>
      <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileError")}</p>
      <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" data-testid="mc-profile-retry" onClick={onRetry}>{t("common.retry")}</button>
    </> : [{ id: "", displayName: t("chatReact.profileDefault"), enabled: true } as ProfileRow, ...rows].map((row) => <div key={row.id}>
      <button type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
        aria-checked={selected === row.id} disabled={saving || !row.enabled} title={row.enabled ? undefined : t("chatReact.optionUnavailable")}
        onClick={() => { if (row.id !== selected) onChange(row.id); }}>
        <span className="mc-menu-text">{row.displayName || row.id}{row.enabled ? "" : `（${t("chatReact.optionUnavailable")}）`}</span>
        {selected === row.id && <CheckMark size={14} />}
      </button>
      {selected === row.id && row.id && <p className="mc-menu-label mc-profile-detail" data-testid="mc-profile-detail">{row.displayName} · {effort(row) ? `${t("chatReact.effort")} ${t(`chatReact.effort${cap(effort(row)!)}`)}` : t("chatReact.effortDefault")}</p>}
    </div>)}
    {rolledBack && <p className="mc-menu-label mc-error" role="alert">{t("chatReact.profileRolledBack")}</p>}
    {outside && !saving && <p className="mc-menu-label">{t("chatReact.profileEffortNote")}</p>}
    <p className="mc-menu-label">{t("chatReact.profileNote")}</p>
  </div>;
}
