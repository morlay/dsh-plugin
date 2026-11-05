// 右栏的「文件预览」标签（上游 `ui-sidebar-documentpreview` 的 client 半）。
//
// 它 claim 的是 `dsh-resource://file/session/<sessionId>/<path>` 这类 tab 地址——没有它，
// 从文件树点开一个文件会抛 `sidebarRight: no registered tab type claims "dsh-resource://file/…"`。
import * as UiDocumentPreviewPlugin from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Locale, Remote, Resources, Slots } from "@morlay/zephyr-app/client";
import { WORKSPACE_FILES_REMOTE_KEY } from "@morlay/dsh-workspace/endpoint";

@Injectable()
export class SidebarDocumentPreviewSlots extends fromCordis(UiDocumentPreviewPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly resources = inject(Resources);

  override async onInit(ctx: Context): Promise<void> {
    // `sidebarRightTabs` / `fileDrag` 从真 cordis 服务取（与另外两个右栏行同一个理由：
    // 上游要的成员不在我们的契约上）。
    const read = (name: string): unknown =>
      (ctx as unknown as { get(n: string): unknown }).get(name);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      configForms: this.configForms,
      resources: this.resources,
      sidebarRightTabs: read("sidebarRightTabs"),
      fileDrag: read("fileDrag"),
      // 带点的名字按字面键给。
      [WORKSPACE_FILES_REMOTE_KEY]: this.remote,
    });
  }
}
