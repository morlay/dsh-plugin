// 旧代形状归一：消息形状、PTC 改名、自造事件的 ignorable 信封（读与写两个方向共用）。
//
// 只认白名单：其它未知类型保持 fail loud（那是「数据来自更新的 harness」的信号，不能吞掉）。
import type { UserMessage } from "@morlay/dsh-agent/contract";
import { withEventType } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionEventType } from "@morlay/dsh-session/contract";


export function repairAssistantSettlement(events: SessionEvent[]): void {
  for (const event of events) {
    if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
    const data = event.data as Record<string, unknown>;
    if (!Array.isArray(data["stream"])) data["stream"] = [];
  }
}

export function repairRequestHeaders(events: SessionEvent[]): void {
  for (const event of events) {
    if (event.type !== "request/header") continue;
    const data = event.data as Record<string, unknown>;
    const header = data["header"];
    if (typeof header !== "object" || header === null || Array.isArray(header)) continue;
    const record = header as Record<string, unknown>;
    delete record["system"];
    if (Array.isArray(record["tools"]) && record["tools"].length === 0) delete record["tools"];
    const defaults = record["adapterDefaults"];
    if (
      typeof defaults === "object" &&
      defaults !== null &&
      !Array.isArray(defaults) &&
      Object.keys(defaults).length === 0
    ) {
      delete record["adapterDefaults"];
    }
  }
}

const PTC_EVENT_RENAMES: Record<string, SessionEventType> = {
  "tool/code-dispatch-start": "tool/ptc-dispatch-start",
  "tool/code-dispatch": "tool/ptc-dispatch",
};

// 旧代 PTC 插件写的来源是 `{ kind: "plugin", plugin: "tools-code-mode" }`；改名成现在的 `tools-ptc`。
function renamePtcMessageSource(message: UserMessage): UserMessage {
  const source = message.source;
  // 盘上来的数据不可信：`agent/inbox/spliced` 的 `inserted` 项可能只有一个 `{ id }`，`source` 整个缺，
  // 所以运行时守卫不能省（`typeof undefined` 是 `"undefined"`，走早返回）。
  if (typeof source !== "object" || source === null) return message;
  if (!("plugin" in source) || source.plugin !== "tools-code-mode") return message;
  return { ...message, source: { ...source, plugin: "tools-ptc" } };
}

export function renameLegacyPtcEvents(events: SessionEvent[]): void {
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const renamedType = PTC_EVENT_RENAMES[event.type];
    if (renamedType !== undefined) {
      events[index] = withEventType(event, renamedType, event.data);
      continue;
    }
    if (event.type === "agent-preset/selected") {
      if (event.data.agentPreset === "code") {
        events[index] = withEventType(event, event.type, { ...event.data, agentPreset: "ptc" });
      }
      continue;
    }
    if (event.type === "user/message") {
      const renamed = renamePtcMessageSource(event.data);
      if (renamed !== event.data) {
        events[index] = withEventType(event, event.type, renamed);
      }
      continue;
    }
    if (event.type === "agent/inbox/spliced" || event.type === "session/title-llm-request") {
      const data = event.data as Record<string, unknown>;
      const key = event.type === "agent/inbox/spliced" ? "inserted" : "messages";
      const list = data[key];
      if (!Array.isArray(list)) continue;
      const renamed = list.map(renamePtcMessageSource);
      if (renamed.some((message, position) => message !== list[position])) {
        events[index] = {
          ...event,
          data: { ...data, [key]: renamed },
        } as unknown as SessionEvent;
      }
    }
  }
}

// 把**旧代（v3 及更早）的消息形状**归一到当前格式（v4）：迁移链（严格）拒绝那些形状时，读路径仍要能把它们
// 读出来——只动字段与标记，不改坐标、不改内容。三件事：`system/message` 的 source 去掉 plugin 形状（v4 只认
// `{ kind: 'system-prompt' }`）、`tool/result` 改成 `role: 'tool'` + 顶层 `toolCallId`、`OWN_EVENT_TYPES` 里的
// 事件补 `ignorable: true` 信封。
// 只认这张白名单：**其它未知类型保持 fail loud**（那是「数据来自更新的 harness」的信号，不能吞掉）。
export function normalizeToCurrentShape(events: SessionEvent[]): void {
  for (const event of events) {
    const type = (event as { type: string }).type;
    if (OWN_EVENT_TYPES.has(type)) {
      (event as { ignorable?: true }).ignorable = true;
      continue;
    }
    if (type === "system/message") {
      const message = (event.data as Record<string, unknown>)["message"];
      liftSystemMessageSource(message);
      continue;
    }
    if (type === "tool/result") {
      const message = (event.data as Record<string, unknown>)["message"];
      liftToolResultMessage(message);
    }
  }
}

function liftSystemMessageSource(message: unknown): void {
  if (typeof message !== "object" || message === null) return;
  const record = message as Record<string, unknown>;
  const source = record["source"];
  if (typeof source !== "object" || source === null) return;
  if ((source as Record<string, unknown>)["kind"] !== "plugin") return;
  record["source"] = { kind: "system-prompt" };
}

function liftToolResultMessage(message: unknown): void {
  if (typeof message !== "object" || message === null) return;
  const record = message as Record<string, unknown>;
  if (record["role"] === "tool" && typeof record["toolCallId"] === "string") return;
  const source = record["source"] as Record<string, unknown> | undefined;
  const block = Array.isArray(record["content"]) ? record["content"][0] : undefined;
  if (typeof block !== "object" || block === null) return;
  const lifted = block as Record<string, unknown>;
  const callId = lifted["toolCallId"] ?? source?.["callId"];
  if (typeof callId !== "string") return;
  record["role"] = "tool";
  record["toolCallId"] = callId;
  record["content"] = Array.isArray(lifted["content"]) ? lifted["content"] : [];
  if (typeof lifted["isError"] === "boolean") record["isError"] = lifted["isError"];
  record["source"] = { kind: "tool", callId };
}

// 落库前给**本仓库自造的事件类型**补上 `ignorable: true` 信封：上游持久化校验（`validateStoredEvents`）只放行
// 「已知类型」或「带可忽略信封的未知类型」，不补连写入都会被拒。`Session.append` 没有承载信封的口子，所以这一笔
// 由持久化层补——canonical log 的形状不变，落库的那一份带上信封；`events` 是即将落库的批次（可写）。
export function sealOwnEvents(events: readonly SessionEvent[]): void {
  for (const event of events) {
    if (OWN_EVENT_TYPES.has((event as { type: string }).type)) {
      (event as { ignorable?: true }).ignorable = true;
    }
  }
}

// 本仓库自造、上游不认识的事件类型：读的时候标 `ignorable: true`，v4 的持久化校验才肯跳过它们
// （`validateStoredEvents` 只放行「已知类型」或「带可忽略信封的未知类型」）。两类都在表里：既有日志里会出现、
// 但本仓库不再产出的 `session-branch/version`，与当前在写的 `session-mode/selected`（上游已知类型表由上游仓库
// 的声明生成，外部插件的事件按构造就在它之外）。
// 新增自造事件类型时**必须**登记到这里，否则读路径 fail loud。**不要**用「所有未知类型」代替（那会掩盖更新
// 版本的未知事件——那种必须拒读）。
export const OWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "session-branch/version",
  "session-mode/selected",
]);

// 这批事件是否需要按当前形状归一（旧代消息形状，或尚未标 `ignorable` 的自造事件类型）——既有日志里可能有以
// 当前版本号落库的回退视图结果，所以**版本号不可信**，读之前要按内容判一次。
export function needsShapeAdoption(events: readonly SessionEvent[]): boolean {
  for (const event of events) {
    const type = (event as { type: string }).type;
    if (OWN_EVENT_TYPES.has(type)) return true;
    if (type === "system/message") {
      const message = (event.data as Record<string, unknown>)["message"] as
        | Record<string, unknown>
        | undefined;
      const source = message?.["source"] as Record<string, unknown> | undefined;
      if (source?.["kind"] === "plugin") return true;
      continue;
    }
    if (type === "tool/result") {
      const message = (event.data as Record<string, unknown>)["message"] as
        | Record<string, unknown>
        | undefined;
      if (message !== undefined && message["role"] !== "tool") return true;
    }
  }
  return false;
}