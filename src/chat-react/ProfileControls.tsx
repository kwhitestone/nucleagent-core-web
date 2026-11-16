import { useEffect, useId, useState } from "react";
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import { CheckMark } from "./icons";
import type { ProfileSelection } from "./modelProfile";
import type { Translate } from "./ChatApp";

interface Profile { id: string; displayName: string; enabled: boolean; reason?: string }

/** MUYU-408 profile choices, rendered only as slot content of the one Controls panel (ModelControls children). */
export default function ProfileControls({ t, backend, providerId, model, scope, value, onChange }: {
  t: Translate; backend: string; providerId?: number; model: string; scope: string;
  value: ProfileSelection | null; onChange(value: ProfileSelection): void;
}) {
  const [catalog, setCatalog] = useState<{ scope: string; profiles: Profile[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    getPlatformRuntime().http.get<{ data: Profile[] }>("/api/v1/addons/conversation/model-profiles", {
      params: { executionBackend: backend, providerId, model },
    }).then((response) => { if (active) setCatalog({ scope, profiles: response.data.data }); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [scope, backend, providerId, model]);
  const profiles = catalog?.scope === scope && !error ? catalog.profiles : [];
  const selected = value?.scope === scope ? value.profileId : "";
  const id = useId();
  // Its own radio group, so assistive tech does not count these with the effort radios of the same menu.
  return <div role="group" aria-labelledby={id}>
    <div className="mc-menu-label" id={id}>{t("chatReact.profile")}</div>
    {/* shortcut: a failed load is retried only on a model/conversation change or reload; add a retry item if this shows up in TEST. */}
    {error && <p className="mc-menu-label" role="alert">{t("chatReact.profileError")}</p>}
    {[{ id: "", displayName: t("chatReact.effortDefault"), enabled: true } as Profile, ...profiles].map((profile) =>
      <button key={profile.id} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item"
        aria-checked={selected === profile.id} disabled={!profile.enabled} title={profile.enabled ? undefined : profile.reason}
        onClick={() => onChange({ scope, profileId: profile.id })}>
        <span className="mc-menu-text">{profile.displayName}{profile.enabled || !profile.reason ? "" : `（${profile.reason}）`}</span>
        {selected === profile.id && <CheckMark size={14} />}
      </button>)}
    <p className="mc-menu-label">{t("chatReact.profileNote")}</p>
  </div>;
}
