// 设置 schema 服务的**实现**：契约与实现同目录（`settings-schema.contract.ts` / 本文件）。
//
// 这个令牌的实例**由上游 `ui-settings` 的 apply 注册**（`new SettingsSchemaService(ctx)`），不由我们造。
// 「契约有实现没有」的缺口来自装配时机：`assertResolvable` 在任何 onInit 之前跑，那时 store 里还没
// 有这个名字，所以令牌条目必须由清单给；而任何 `extends SettingsSchema` 的非适配行都会在装配期先
// `store.provide('settingsSchema', …)`，与上游那次注册撞名。
//
// 所以这里用**适配行**：`fromCordis` 的产物标记为 adapted，装配不抢先注册；`mount` 之后按契约名从
// store 取上游实例（`fromCordis` 的 `faceFromStore`），7 个成员由它转发。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms } from "./config-forms.contract.ts";
import { SettingsSchema } from "./settings-schema.contract.ts";

/**
 * 空的上游行：本行只需要 `mount` 的取面动作（`settingsSchema` 由 `SettingsHost` 那次 apply 注册），
 * 没有自己的插件可跑。
 */
const NoPlugin = { name: "settings-schema-host", apply(): void {} };

/** `ctx.settingsSchema` 的实现：上游服务实例的契约面。 */
@Injectable()
export class SettingsSchemaDefault extends fromCordis(SettingsSchema, NoPlugin) {
  /**
   * 顺序边：`configForms` 由 `SettingsHost` 提供，它的 `mount` 里才注册 `settingsSchema`。
   * 声明依赖（不读值）就够——拓扑排序据此把本行排在它之后。
   */
  protected readonly configForms = inject(ConfigForms);

  /**
   * 取面：`mount` 之后本行的契约面就是上游那个实例。
   * @param ctx - 本行的上下文。
   */
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {});
  }
}
