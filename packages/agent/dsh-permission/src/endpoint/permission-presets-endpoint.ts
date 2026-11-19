// `permissionPresets` 这一组的跨端契约：权限面板读的预设目录。
//
// 上游 descriptor：`vendor/deepseek-harness/packages/interaction/permission-presets/lib/typert.remote-client.ts:54`
// （`permissionPresets/catalog: () => Promise<RemoteResult<PermissionCatalog>>`）。
// 只取类型：走上游的 `types` 子路径 + `import type`。值导入（哪怕只用在类型位置）会被打包图收边，
// 把上游宿主根拖进浏览器——`./endpoint` 是两端共用的面，必须 client-safe。
import type { PermissionCatalog } from "@deepseek-ai/dsh-permission-presets/types";
import {
  RemoteGroup,
  RemoteMethod,
  remoteGroupNameOf,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";

/**
 * 组名（`permissionPresets`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function permissionPresetsGroupName(): string {
  const group = remoteGroupNameOf(PermissionPresetsEndpoint);
  if (group === undefined) throw new Error("PermissionPresetsEndpoint 没有 @RemoteGroup：组名取不到");
  return group;
}

/** `permissionPresets` 组：预设目录。 */
@RemoteGroup({ name: "permissionPresets" })
export class PermissionPresetsEndpoint {
  /**
   * 读当前可选的全部预设（贡献顺序）。
   * @returns 目录；失败用 `{ ok: false }` 带原因。
   */
  @RemoteMethod()
  async catalog(): Promise<RemoteResultWire<PermissionCatalog>> {
    throw new Error("permissionPresets/catalog：契约类未实现（宿主侧要在子类里实现它）");
  }
}
