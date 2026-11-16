import type { Translate } from "./ChatApp";
import type { TurnUsageView } from "./turnUsage";

export function TurnUsage({ t, usage = { state: "unknown", points: "—", upstreams: [] } }: { t: Translate; usage?: TurnUsageView }) {
  return <span className="mc-usage" data-testid="mc-turn-usage" data-settlement={usage.state}
    aria-label={t("chatReact.turnUsage")} title={t(`chatReact.usage${usage.state[0]!.toUpperCase()}${usage.state.slice(1)}`)}>
    {t("chatReact.points")}: {usage.points}{usage.state === "pending" && <> · {t("chatReact.usagePending")}</>}
    {usage.upstreams.length > 0 && <> · {t("chatReact.upstream")}: {usage.upstreams.join(" / ")}</>}
  </span>;
}
