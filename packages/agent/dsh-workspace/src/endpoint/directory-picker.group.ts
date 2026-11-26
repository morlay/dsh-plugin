// `directoryPicker` 组的**两端共用面**：组名、方法名与 wire 形参 / 应答类型。
//
// 上游真源：`vendor/deepseek-harness/packages/api/workspace-controller/src/directory-picker.ts:41`
// （`DirectoryPickerController`）：`pick(signal)` / `list(path, signal)` / `createDirectory(path, name)`——
// **位置形参、裸值**。客户端面由上游那份 remote 挂，所以宿主必须按同一形状收参数、回裸值。
import type { DirectoryListing } from "@deepseek-ai/dsh-api-workspace-controller/types";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import { groupNameOf, RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { DirectoryPickerController as DirectoryPickerHost } from "@deepseek-ai/dsh-api-workspace-controller";

/**
 * 组名（`directoryPicker`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function directoryPickerGroupName(): string {
  return groupNameOf(DirectoryPickerEndpoint);
}

/** `directoryPicker` 组：列目录 / 建目录 / 原生选择器。 */
@RemoteGroup({ name: "directoryPicker" })
export class DirectoryPickerEndpoint {
  /**
   * 列一个目录。
   * @param _path - 目标目录（`undefined` 取 backend 的默认落点；wire 名 `path`）。
   * @returns 目录清单（面包屑 + 条目 + 是否截断）。
   */
  @RemoteMethod({ parameters: ["path"] })
  async list(_path: string | undefined): Promise<DirectoryListing> {
    throw new Error("directoryPicker/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 在父目录下建一个子目录。
   * @param _path - 父目录（wire 名 `path`）。
   * @param _name - 目录名（wire 名 `name`）。
   * @returns 新目录的绝对路径。
   */
  @RemoteMethod({ parameters: ["path", "name"] })
  async createDirectory(_path: string, _name: string): Promise<string> {
    throw new Error("directoryPicker/createDirectory：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 打开原生选择器（无可选参数：`signal` 走 cancellation）。
   * @returns 选中的路径；用户关掉对话框是 `null`（也是成功）。
   */
  @RemoteMethod({ parameters: [] })
  async pick(): Promise<string | null> {
    throw new Error("directoryPicker/pick：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * 覆盖守卫：契约对上**宿主类** `DirectoryPickerController` 的 wire 面。
 *
 * 投影两步：`DropParam`（末尾 `signal` 走 cancellation）→ `AsyncReturn`（异步化；本组无 lookup 形参）。
 */
type DirectoryPickerWire = AsyncReturn<DropParam<DirectoryPickerHost, AbortSignal>>;

export type DirectoryPickerEndpointCovered = AssertTrue<
  AssertWireFace<Pick<DirectoryPickerWire, "list" | "createDirectory" | "pick">, DirectoryPickerEndpoint>
>;
