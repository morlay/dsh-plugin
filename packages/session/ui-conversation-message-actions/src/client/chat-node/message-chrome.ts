import type { Translate } from "@deepseek-ai/dsh-client-ui-slots";

export type ClockTranslate = Translate<"clock.md" | "clock.ymd">;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - ms, 1);
}

export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

export function formatMessageClock(
  time: number,
  t: ClockTranslate,
  now: number = Date.now(),
): string {
  const d = new Date(time);
  const n = new Date(now);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  ) {
    return clock;
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  const md = d.getFullYear() === n.getFullYear() ? t("clock.md", params) : t("clock.ymd", params);
  return `${md} ${clock}`;
}
