/**
 * client 半与 host 的**唯一**通路：模式清单（`GET`）与切换（`POST`）。
 *
 * 当前模式不走这里——它是一条会话投影（`sessionMode`），随会话列表一起到页面，组件用 `useSessions`
 * 读它。于是这里只剩两件事：拉清单、发一次切换。
 */

import {
  SESSION_MODE_PATH,
  type SessionModeRoster,
  type SessionModeSelectResult,
} from "../shared.ts";

/** 读一次模式清单；清单在页面生命周期里是静态的（装配事实），调用方自己缓存。 */
export async function fetchRoster(): Promise<SessionModeRoster> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return (await response.json()) as SessionModeRoster;
}

/**
 * 把某个空白会话切到某个模式。
 * @param sessionId - 目标会话。
 * @param mode - 目标模式 id。
 * @returns 提交后的模式 id。
 * @throws 会话已开始、模式不存在、会话不存在——host 给的中文原因。
 */
export async function selectMode(sessionId: string, mode: string): Promise<string> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, mode }),
  });
  const value = (await response.json().catch(() => undefined)) as
    | (Partial<SessionModeSelectResult> & { error?: unknown })
    | undefined;
  if (!response.ok) {
    const error = value?.["error"];
    throw new Error(typeof error === "string" ? error : `HTTP ${String(response.status)}`);
  }
  return value?.mode ?? mode;
}
