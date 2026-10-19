// `permissionPresets` 这一组的跨端契约：权限面板读的预设目录。
//
// 上游 descriptor：`vendor/deepseek-harness/packages/interaction/permission-presets/lib/typert.remote-client.ts:54`
// （`permissionPresets/catalog: () => Promise<RemoteResult<PermissionCatalog>>`）。
import { PermissionCatalog } from "@deepseek-ai/dsh-permission-presets";
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/** wire 上的端点名。 */
export const PERMISSION_PRESETS_CATALOG_ENDPOINT = "permissionPresets/catalog";

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
