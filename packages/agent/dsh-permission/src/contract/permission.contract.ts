// 权限预设契约：令牌按服务语义命名（上游注册名 `permissionPresets`）。
import type PermissionPresetService from "@deepseek-ai/dsh-permission-presets";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/**
 * 契约面：上游 `PermissionPresetService` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/**
 * 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。
 *
 * `typertRemote` 不进契约：它是 `TypertRemoteService` 的网关绑定（给 gateway 做发现用），
 * 不是服务面——上游插件从不按 `ctx.<service>.typertRemote` 取用。
 *
 * 为什么不是 `implements`：上游 `PermissionPresetService` 是 cordis `Service` 类（带私有成员），
 * `implements` 会报 TS2720；签名守卫在这里等价。
 */
export type PermissionCovered = AssertTrue<
  AssertCoveredStrict<Omit<PermissionPresetService, "typertRemote">, Permission>
>;

@Injectable({ name: "permissionPresets" })
export abstract class Permission {
  abstract readonly names: PermissionPresetService["names"];

  abstract readonly catalog: PermissionPresetService["catalog"];

  abstract readonly registerAuto: PermissionPresetService["registerAuto"];

  abstract readonly defaultPreset: PermissionPresetService["defaultPreset"];

  abstract readonly current: PermissionPresetService["current"];

  abstract readonly resolve: PermissionPresetService["resolve"];

  abstract readonly optionOf: PermissionPresetService["optionOf"];

  abstract readonly set: PermissionPresetService["set"];

  /** 直接写预设（上游 0.2.3 新增：与界面开关同一条写入口）。 */
  abstract readonly setPreset: PermissionPresetService["setPreset"];
}
