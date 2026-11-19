// `directoryPicker` 组的**两端共用面**：组名、deps 键、方法名与每个方法的请求/应答形状。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧
// （`server/directory-picker-endpoint.service.ts`）继承它实现方法，wire 上叫什么不在别处再写一份。
// 客户端形态不在本仓：这一组的客户端面由上游 `@deepseek-ai/dsh-api-workspace-controller#directoryPicker`
// 的 `$mount` 面提供（`ui/` 按 `remote.<组>` 调），所以这里只有宿主侧要实现的声明。
import type { DirectoryListing } from "@deepseek-ai/dsh-api-workspace-controller/types";
import { groupNameOf, RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/**
 * 组名（`directoryPicker`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function directoryPickerGroupName(): string {
  return groupNameOf(DirectoryPickerEndpoint);
}

/**
 * `directoryPicker` 组：列目录 / 建目录 / 原生选择器。
 *
 * wire 上的参数名就是 descriptor 的命名参数（`list` 收 `path`，`createDirectory` 收 `path` + `name`，
 * `pick` 不收），与 `registerRemoteGroup` 的「整个 args 就是请求」同一约定。应答是**裸值**
 * （与上游 `@Remote` 同协议，失败即异常）；客户端的 `remote.<组>` 面再包成 `RemoteResult`。
 */
@RemoteGroup({ name: "directoryPicker" })
export class DirectoryPickerEndpoint {
  /**
   * 列一个目录。
   * @param _request - 目标目录；省略取 backend 的默认落点。
   * @returns 目录清单（面包屑 + 条目 + 是否截断）。
   */
  @RemoteMethod()
  async list(_request: { readonly path?: string }): Promise<DirectoryListing> {
    throw new Error("directoryPicker/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 在父目录下建一个子目录。
   * @param _request - 父目录与目录名。
   * @returns 新目录的绝对路径。
   */
  @RemoteMethod()
  async createDirectory(_request: {
    readonly path: string;
    readonly name: string;
  }): Promise<string> {
    throw new Error("directoryPicker/createDirectory：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 打开原生选择器。
   * @returns 选中的路径；用户关掉对话框是 `null`（也是成功）。
   */
  @RemoteMethod()
  async pick(): Promise<string | null> {
    throw new Error("directoryPicker/pick：契约类未实现（宿主侧要在子类里实现它）");
  }
}
