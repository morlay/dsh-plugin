// client 半与 host 的**唯一**通路：模式清单（`GET`）与切换（`POST`）。当前模式是会话投影（`sessionMode`），
// 随会话列表一起到页面，不走这里。

import {
  SESSION_MODE_PATH,
  type SessionModeActiveState,
  type SessionModeRoster,
  type SessionModeSelectResult,
} from "../shared.ts";

// 读一次模式清单；清单在页面生命周期里是静态的（装配事实），调用方自己缓存。
export async function fetchRoster(): Promise<SessionModeRoster> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeRoster;
}

// 把某个空白会话切到某个模式；失败抛 host 给的中文原因（会话已开始 / 模式不存在 / 会话不存在）。
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

// 读某个会话**当下生效**的那一份（工具是运行期可见集，MCP 组加载后会变），侧边栏面板用。

// 错误响应体里的 `error` 是 host 给的可读原因：原样抛出来，别让页面只剩一个 HTTP 状态码。
async function failure(response: Response): Promise<Error> {
  const value = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  return new Error(
    typeof value?.error === "string" ? value.error : `HTTP ${String(response.status)}`,
  );
}

export async function fetchActive(sessionId: string): Promise<SessionModeActiveState> {
  const response = await fetch(`${SESSION_MODE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 面板的写面：改这个会话的三个注入开关；返回新的生效态。
export async function updateSwitches(
  sessionId: string,
  switches: Partial<Record<"instructions" | "skills" | "runtimeContext", boolean | null>>,
): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, switches }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 把当前会话的开关覆盖写回这个模式的配置（对之后的新会话生效）。
export async function saveSwitchesAsDefault(sessionId: string): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, saveAsDefault: true }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 会话级的字段覆盖（`null` = 回到模式默认）。
export async function updateModePatch(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, modePatch: patch }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 以当前会话的生效配置另存为一个新模式。
export async function saveAsNewMode(sessionId: string, code: string, name: string): Promise<void> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, saveAsNewMode: { code, name } }),
  });
  if (!response.ok) throw await failure(response);
}

// 删除一个"另存为"出来的模式（内置模式由 host 拒绝）。
export async function deleteMode(sessionId: string): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, deleteMode: true }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 会话级逐条目三态（`null` = 回到模式默认）。
export async function updateItemState(
  sessionId: string,
  kind: "tools" | "skills" | "policies",
  id: string,
  value: "allow" | "deny" | null,
): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, itemState: { kind, id, value } }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 一次性应用整份会话覆盖（面板的"应用到会话"）。
export async function applySessionConfig(
  sessionId: string,
  config: import("../mode-config.ts").ModeConfig,
): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, applyConfig: { config } }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}

// 把草稿写回配置（"保存为默认"）：传的是完整 `ModeConfig`。
export async function saveConfigDraft(
  sessionId: string,
  config: import("../mode-config.ts").ModeConfig,
): Promise<SessionModeActiveState> {
  const response = await fetch(SESSION_MODE_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ sessionId, saveConfig: { config } }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SessionModeActiveState;
}
