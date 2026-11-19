// 转发事件的**请求侧**：把一条要答复的请求派发给应答者（浏览器），等它回值。
//
// 为什么要有这一条：需要「问人」的调用方（权限域的批准与提问）在契约面只该看到这一件事，
// 不该知道帧怎么走。派发是 cordis 的 waterfall（`user-questions/request`，带 scope carrier），
// 浏览器那半由本行的 `RemoteEventsSource` 接手，答复仍经 `$events/result` 回到宿主。
import { Injectable } from "@morlay/zephyr";

/** 一次请求所属的 agent（上游 `Agent` 的这两个成员就够）。 */
export interface ScopedAgentRef {
  readonly id: string;
  readonly ctx: object;
}

/**
 * 转发事件的请求面（宿主半）。
 *
 * 实现是本行的 `RemoteEventsSource`：它把请求派发成 waterfall，并把帧交给 gateway 投给浏览器。
 */
@Injectable()
export abstract class RemoteQuestions {
  /**
   * 把一条请求推到浏览器，等它的答复。
   * @param event - 事件名（`user-questions/request` / `approval/request`）。
   * @param request - 请求本体（会被投影成 JSON 安全的形状再下发给浏览器）。
   * @param agent - 请求所属的 agent。
   * @returns 浏览器给出的答案。
   */
  abstract ask(event: string, request: object, agent: ScopedAgentRef): Promise<unknown>;
}
