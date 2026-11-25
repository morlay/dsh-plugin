// 设置 schema 服务（上游 `ui-settings` 的 apply 里 `ctx.reflect.provide('settingsSchema', …)`）。
//
// 消费方是 `ui-settings-models`：它把这一面交给上游的 schema operations 之后按命名空间读字段描述。
// 令牌 `name` 显式对齐上游注册名（`settingsSchema`），按名字与按令牌拿到的是同一份实例。
//
// 令牌是**抽象类**而不是 `InjectionToken`：实现只能 `extends` 这份契约，成员缺一个就编译不过。
// 成员签名直接取上游 `SettingsSchemaService` 的同名成员（不手抄一份会漂的声明）。
import { Injectable } from "@morlay/zephyr";
import type { SettingsSchemaService } from "@deepseek-ai/dsh-client-ui-settings/client";

/** `ctx.settingsSchema` 的面：上游那个服务类。 */
export type SettingsSchemaFace = SettingsSchemaService;

/** `ctx.settingsSchema`：按命名空间取字段描述（上游 `SettingsSchemaService`）。 */
@Injectable({ name: "settingsSchema" })
export abstract class SettingsSchema {
  /** 把一份序列化的 schema 信封还原成活的节点。 */
  abstract readonly rehydrate: SettingsSchemaFace["rehydrate"];

  /** 校验一份设置草稿（合法时 `undefined`）。 */
  abstract readonly validate: SettingsSchemaFace["validate"];

  /** 按路径取一个对象 / 字典 / 数组节点。 */
  abstract readonly nodeAtPath: SettingsSchemaFace["nodeAtPath"];

  /** 按路径读一个嵌套值。 */
  abstract readonly getPath: SettingsSchemaFace["getPath"];

  /** 按路径判断是否存在。 */
  abstract readonly hasPath: SettingsSchemaFace["hasPath"];

  /** 按路径写一个嵌套值（返回新对象）。 */
  abstract readonly setPath: SettingsSchemaFace["setPath"];

  /** 按路径删一个嵌套值（返回新对象）。 */
  abstract readonly deletePath: SettingsSchemaFace["deletePath"];
}
