// 权限预设契约：令牌按服务语义命名（上游注册名 `permission`）。
import type PermissionPresetService from "@deepseek-ai/dsh-permission-presets";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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
 */
export type PermissionCovered = AssertTrue<
  AssertCovered<Omit<PermissionPresetService, "typertRemote">, Permission>
>;

@Injectable()
export abstract class Permission {
  abstract readonly names: PermissionPresetService["names"];

  abstract readonly catalog: PermissionPresetService["catalog"];

  abstract readonly registerAuto: PermissionPresetService["registerAuto"];

  abstract readonly defaultPreset: PermissionPresetService["defaultPreset"];

  abstract readonly current: PermissionPresetService["current"];

  abstract readonly resolve: PermissionPresetService["resolve"];

  abstract readonly optionOf: PermissionPresetService["optionOf"];

  abstract readonly set: PermissionPresetService["set"];
}

