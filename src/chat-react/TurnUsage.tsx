import type { Translate } from "./ChatApp";
import { cap } from "./requestEffort";
import { UNKNOWN_USAGE, type TurnUsageView } from "./turnUsage";

export function TurnUsage({ t, usage = UNKNOWN_USAGE }: { t: Translate; usage?: TurnUsageView }) {
  return <span className="mc-usage" data-testid="mc-turn-usage" data-settlement={usage.state}
    aria-label={t("chatReact.turnUsage")} title={t(`chatReact.usage${cap(usage.state)}`)}>
    {t("chatReact.points")}: {usage.points}{usage.state === "pending" && <> · {t("chatReact.usagePending")}</>}
    {usage.upstreams.length > 0 && <> · {t("chatReact.upstream")}: {usage.upstreams.join(" / ")}</>}
  </span>;
}
