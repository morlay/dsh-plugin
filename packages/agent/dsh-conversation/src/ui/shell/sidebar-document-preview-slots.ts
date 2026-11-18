// 右栏的「文件预览」标签（上游 `ui-sidebar-documentpreview` 的 client 半）。
//
// 它 claim 的是 `dsh-resource://file/session/<sessionId>/<path>` 这类 tab 地址——没有它，
// 从文件树点开一个文件会抛 `sidebarRight: no registered tab type claims "dsh-resource://file/…"`。
import * as UiDocumentPreviewPlugin from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import {
  ConfigForms,
  FileDragDefault,
  Locale,
  Remote,
  Resources,
  Slots,
} from "@morlay/zephyr-app/client";
import { WORKSPACE_FILES_REMOTE_KEY } from "@morlay/dsh-workspace/endpoint";
import { SidebarRightTabs } from "../ports.ts";

@Injectable()
export class SidebarDocumentPreviewSlots extends fromCordis(UiDocumentPreviewPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly resources = inject(Resources);

  /** tab 类型注册表：令牌带上游注册名 `sidebarRightTabs`，与 `ctx.get('sidebarRightTabs')` 同一份实例。 */
  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  /** 拖拽面：本仓 `ui-file-drag` 那一行（`FileDragDefault`）的真身，上游按 `ctx.fileDrag` 读它。 */
  private readonly fileDrag = inject(FileDragDefault);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      configForms: this.configForms,
      resources: this.resources,
      sidebarRightTabs: this.sidebarRightTabs,
      fileDrag: this.fileDrag,
      // 带点的名字按字面键给。
      [WORKSPACE_FILES_REMOTE_KEY]: this.remote,
    });
  }
}
