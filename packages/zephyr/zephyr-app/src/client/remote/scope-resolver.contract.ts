// 客户端侧的**作用域解析**：转发的请求（审批、用户提问）在 wire 上只带一个 id，要换成本端的
// 作用域对象才能把 `this` 交给 listener —— 上游 `ui-approval` / 用户提问卡片都靠「作用域对象」
// 认会话，拿不到就直接 `next()`（**卡片永远不弹**）。
//
// 框架只承诺「id → 作用域」这一件事，**不解释这个 id 属于哪个域**：契约在框架层（wire 只认 id），
// 实现在知道 id 语义的那个域。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ClientScopeResolver {
  /**
   * 取一个请求所属的作用域。
   * @param id - 宿主随转发请求给出的作用域 id。
   * @returns 客户端作用域；解析不出来时 `undefined`（调用方按"没人认这条请求"处理）。
   */
  abstract resolve(id: string): object | undefined;
}
