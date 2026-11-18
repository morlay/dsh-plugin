// 上游 `DirectoryPickerController` 的**适配行**：只负责把它装起来并把 backend 交进去。
//
// 为什么拆成两行、而不是让 wire 端点行直接 `fromCordis`：契约类的组名与方法元数据要走**类的原型链**
// （`registerRemoteGroup` 沿链收集），所以端点行必须 `extends DirectoryPickerEndpoint`；
// 而 `fromCordis(...)` 也是继承，两者不能同时继承。于是「装上游」与「接 wire」各一行：这一行装上游
// （`server/directory-picker-endpoint.service.ts` 实现契约），元数据的家仍然只有契约一个。
import { DirectoryPickerController } from "@deepseek-ai/dsh-api-workspace-controller";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { DirectoryPickerBackend } from "../contract/directory-picker.contract.ts";

/** 宿主侧要转发的三个动词：形状直接取上游 controller（签名只在一个 home 里）。 */
export type DirectoryPickerHostFace = Pick<
  DirectoryPickerController,
  "list" | "pick" | "createDirectory"
>;

/**
 * 上游实例 → 我们要转发的面。
 *
 * `kFace` 在上游适配面上的类型是 `unknown`，所以这里按
 * **运行时**校验三个动词都是函数再收窄——装配期就报「上游 controller 与 wire 面不同步」，
 * 而不是等第一次请求时炸成 `host.list is not a function`。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns 三个动词齐备时是真。
 */
export function isDirectoryPickerHostFace(value: unknown): value is DirectoryPickerHostFace {
  return (
    value !== null &&
    typeof value === "object" &&
    "list" in value &&
    typeof value.list === "function" &&
    "pick" in value &&
    typeof value.pick === "function" &&
    "createDirectory" in value &&
    typeof value.createDirectory === "function"
  );
}

/**
 * `directoryPicker` 组的上游 controller（`ctx.directoryPicker` 是它的 backend）。
 *
 * 适配行**发布的是上游实例**：`inject(DirectoryPickerControllerRow)` 拿到的就是
 * `DirectoryPickerController`（它挂上来的那一面），wire 端点行因此直接调三个动词。
 */
@Injectable()
export class DirectoryPickerControllerRow extends fromCordis(DirectoryPickerController) {
  private readonly directoryPicker = inject(DirectoryPickerBackend);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {}, { directoryPicker: this.directoryPicker });
  }
}
