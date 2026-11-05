// remote 契约的**客户端基类**：把「转发目标」作为一个实例字段带上来。
//
// 契约类 `extends RemoteClientBase` 之后，客户端形态（`@RemoteGroup()` 的子类）和宿主实现都自动
// 拥有这个字段——不需要每处手写 `inject(Remote)`。`inject()` 是构造期登记，字段必须在实例上存在，
// 而 `extends` 正好满足这一点（装饰器做不到：当前编译是 legacy 语义，单参且返回值不生效）。
//
// 用**必需**注入：继承了这个基类就意味着「需要 remote」。装配里没有它就报错——
// 静默的 `undefined` 会让转发悄悄返回 `undefined`，比装配失败难查得多。
import { inject } from "@morlay/zephyr";
import { Remote } from "./remote.contract.ts";

/** 带 `remote` 字段的基类：`@RemoteGroup` 的转发读它（`remote.upstream.<group>.<method>`）。 */
export abstract class RemoteClientBase {
  /** 转发目标：上游实例面（`remote.upstream.<group>`）。 */
  protected readonly remote = inject(Remote);
}
