// resources 的 **UI 贡献**：把 `resource` keyed hook 挂到 root 标准源（`useResource(address)` 走它）。
//
// 这是「组件/贡献」侧：只依赖 `Resources` 服务契约，不做服务本身的事。
import { inject } from "@morlay/zephyr";
import { Slot, SlotContribution } from "../renderer/slot.decorator.ts";
import { Resources } from "./resources.contract.ts";

@Slot({})
export class ResourcesContribution extends SlotContribution {
  readonly resources = inject(Resources);

  /** root 标准源：`resource` keyed hook（`useResource(address)` 走它）。 */
  slotRoot(): { keyedHooks: Record<string, (address: string) => unknown> } {
    return { keyedHooks: { resource: (address: string) => this.resources.source(address) } };
  }
}
