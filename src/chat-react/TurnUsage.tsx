import type { Translate } from "./ChatApp";
import { cap } from "./requestEffort";
import { fill } from "./singleSlotQueue";
import { UNKNOWN_USAGE, type TurnUsageView } from "./turnUsage";

/**
 * exp106: settled "N 贝壳（≈¥X.XXXX）" (free: "N 贝壳", no ¥) when Core sent the whole contract; otherwise "N 积分".
 * Pending is "待结算" and unknown "计费中": never a number, never ¥. exp116: stale / unavailable rate adds a small note.
 */
export function TurnUsage({ t, usage = UNKNOWN_USAGE, locale = "zh-CN" }: { t: Translate; usage?: TurnUsageView; locale?: string }) {
  const name = usage.name?.[locale] ?? usage.name?.[locale.slice(0, 2)];
  // exp116: the note is small print after the amount; the reason is only a translated hint in the title (unknown code: the note itself).
  const note = usage.note && fill(t(usage.note === "off" ? "chatReact.rateUnavailable" : usage.age === undefined ? "chatReact.rateOld" : "chatReact.rateAge"), { n: usage.age });
  const key = `chatReact.rateReason_${usage.reason}`, hint = usage.reason && t(key);
  // exp117: loading keeps the line's height (nbsp) and says nothing until the first read answers.
  if (usage.loading) return <span className="mc-usage" data-testid="mc-turn-usage" data-settlement="unknown" aria-label={t("chatReact.turnUsage")} aria-busy="true">{"\u00a0"}</span>;
  return <span className="mc-usage" data-testid="mc-turn-usage" data-settlement={usage.state}
    aria-label={t("chatReact.turnUsage")} title={note ? hint && hint !== key ? hint : note : t(`chatReact.usage${cap(usage.state)}`)}>
    {usage.state !== "settled" ? t(usage.state === "pending" ? "chatReact.usagePending" : "chatReact.usageBilling")
      : typeof name === "string" && name ? `${usage.shells} ${name}${usage.points === "0" ? "" : `（≈¥${usage.cny}）`}`
        : `${usage.points} ${t("chatReact.points")}`}
    {note && <small className="mc-usage-note">{` · ${note}`}</small>}
  </span>;
}
