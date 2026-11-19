// 客户端侧的 **agent 作用域解析**：转发的请求（审批、用户提问）只带 `agentId`，
// 要换成客户端的作用域对象才能把 `this` 交给 listener —— 上游 `ui-approval` / 用户提问卡片
// 都用 `sessions.scopeOf(this)` 认会话，拿不到就直接 `next()`（**卡片永远不弹**）。
//
// 契约在框架层（wire 只认 id），实现在会话域（它知道 id ↔ 作用域）。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ClientAgentScopes {
  /**
   * 取一个请求所属的作用域。
   * @param agentId - 宿主给的 agent id（本装配里与会话 id 同值）。
   * @returns 客户端作用域；没有这个会话时 `undefined`（调用方按"没人认这条请求"处理）。
   */
  abstract scopeOf(agentId: string): object | undefined;
}
