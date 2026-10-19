// host 半与 client 半共用的接口面：一条 HTTP 路径、模式行的对外形状、请求与响应体。
// 走 HTTP 路由而不是 Typert Remote：客户端的 remote 清单由上游硬编码，我们的服务不在里面。
// 会话当前模式不走这条通路：它是 session 投影（`sessionMode`），随会话列表一起到页面。

// 模式清单与切换的路由路径：宿主（web 与桌面）在同一张路由表上服务它。
export const SESSION_MODE_PATH = "/session-mode";

// 模式可以改写的上游 **policy 规则**名，即上游 waterfall 的事件名（是事件名、不是路径，所以**不带**前导斜杠）：
// `fs/write-intent`（写意图）与 `fs/edit-intent`（改意图）。home 在这里而不是 `modes.ts`：host 半的装配期校验
// 与 client 半的页面候选键都要它，而 client 半不 import `modes.ts`（免得把 schemastery 拖进浏览器包）。
// 「能拦什么」取决于上游是否在那条 waterfall 上独占决策槽——它不是配置能自己长出来的东西，所以这份名单是封闭的，
// 写进来的名字不在名单里就在装配期拒绝（见 `configProblem`）。
export const POLICY_NAMES = ["fs/write-intent", "fs/edit-intent"] as const;

// 一条 policy 规则的名字。
export type PolicyName = (typeof POLICY_NAMES)[number];

// 一个模式对外的那部分：选择器要的名字与说明。
export interface SessionModeRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

// `GET` 的响应体：清单与默认模式。
export interface SessionModeRoster {
  readonly default: string;
  readonly modes: readonly SessionModeRow[];
}

// `POST` 的请求体：把某个空白会话切到某个模式。
export interface SessionModeSelectRequest {
  readonly sessionId: string;
  readonly mode: string;
}

// `POST` 的响应体：切换后提交的模式 id。
export interface SessionModeSelectResult {
  readonly mode: string;
}
