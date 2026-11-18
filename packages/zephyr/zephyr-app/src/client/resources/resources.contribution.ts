// resources 的 **UI 贡献**：把 `resource` keyed hook 挂到 root 标准源（`useResource(address)` 走它）。
//
// 这是「组件/贡献」侧：只依赖 `Resources` 服务契约，不做服务本身的事。
import { inject } from "@morlay/zephyr";
import type { Slots } from "../renderer/slots.contract.ts";
import { Slot, SlotContribution } from "../renderer/slot.decorator.ts";
import { Resources } from "./resources.contract.ts";

@Slot({})
export class ResourcesContribution extends SlotContribution {
  readonly resources = inject(Resources);

  /** root 标准源：`resource` keyed hook（`useResource(address)` 走它）。 */
  slotRoot(): Parameters<Slots["provideRoot"]>[0] {
    return {
      // 上游 `KeyedStandardSource` 是 `(key, member?) => HostObservable | undefined`，
      // 这里只用到 `key`（address），第二个形参不接。
      keyedHooks: { resource: (key: string) => this.resources.source(key) },
    };
  }
}
