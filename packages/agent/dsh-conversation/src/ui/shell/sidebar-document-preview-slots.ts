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
  fixedSyncedConfig,
  Locale,
  Remote,
  Resources,
  Slots,
} from "@morlay/zephyr-app/client";
import { workspaceFilesGroupName } from "@morlay/dsh-workspace/endpoint";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { SidebarRightTabs } from "../ports.ts";

@Injectable()
export class SidebarDocumentPreviewSlots extends fromCordis(UiDocumentPreviewPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly resources = inject(Resources);

  /**
   * tab 类型注册表：令牌带上游注册名 `sidebarRightTabs`，与 `ctx.get('sidebarRightTabs')` 同一份实例。
   *
   * **这条边靠行序**：注册表是 `SidebarRightSlots` 在 mount 里按名字发布的（值令牌没有实现类，
   * 装配器在该行挂完之后才把它认进令牌表），所以 `provideSessionShellSlots()` 里发布方必须排在本行之前。
   */
  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  /**
   * 拖拽面：本仓 `ui-file-drag` 那一行（`FileDragDefault`）的真身，上游按 `ctx.fileDrag` 读它。
   *
   * 这条边进依赖图（类令牌有提供者），所以**不靠行序**：那一行排在清单哪里都行。
   */
  private readonly fileDrag = inject(FileDragDefault);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 0.2.3 起这份 client 的 `Config` 由 Host 同步（`office` / `excel` 两档上限）：没通道时给"未配置"。
    await this.mount(ctx, fixedSyncedConfig(["office", "excel"]), {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      configForms: this.configForms,
      resources: this.resources,
      sidebarRightTabs: this.sidebarRightTabs,
      fileDrag: this.fileDrag,
      // 带点的名字按字面键给。
      [remoteNamespaceKey(workspaceFilesGroupName())]: this.remote,
    });
  }
}
