import type { Translate } from "./ChatApp";
import { cap } from "./requestEffort";
import { UNKNOWN_USAGE, type TurnUsageView } from "./turnUsage";

/**
 * exp106: settled "N 贝壳（≈¥X.XXXX）" (free: "N 贝壳", no ¥) when Core sent the whole contract; otherwise "N 积分".
 * Pending is "待结算" and unknown "计费中": never a number, never ¥.
 */
export function TurnUsage({ t, usage = UNKNOWN_USAGE, locale = "zh-CN" }: { t: Translate; usage?: TurnUsageView; locale?: string }) {
  const name = usage.name?.[locale] ?? usage.name?.[locale.slice(0, 2)];
  return <span className="mc-usage" data-testid="mc-turn-usage" data-settlement={usage.state}
    aria-label={t("chatReact.turnUsage")} title={t(`chatReact.usage${cap(usage.state)}`)}>
    {usage.state !== "settled" ? t(usage.state === "pending" ? "chatReact.usagePending" : "chatReact.usageBilling")
      : typeof name === "string" && name ? `${usage.shells} ${name}${usage.points === "0" ? "" : `（≈¥${usage.cny}）`}`
        : `${usage.points} ${t("chatReact.points")}`}
  </span>;
}
