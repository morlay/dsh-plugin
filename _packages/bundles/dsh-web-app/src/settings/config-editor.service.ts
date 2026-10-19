// 配置编辑（`@deepseek-ai/dsh-config-editor`）：patch 文档的读写面，`settings` 依赖它。
// 上游 `static inject = ['loader', 'profileContext']`——后者由启动器提供，前者只用到 `await()`。
import ConfigEditorPlugin from "@deepseek-ai/dsh-config-editor";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { LoaderMock } from "./loader.mock.ts";
import { ProfileContextToken } from "./profile-context.ts";

@Injectable()
export class ConfigEditor extends fromCordis(ConfigEditorPlugin) {
  loader = inject(LoaderMock);

  profile = inject(ProfileContextToken);

  protected async onInit(ctx: Context): Promise<void> {
    // 依赖名映射与上游 Config 是两个参数：`mount(ctx, deps)`，config 走 `withConfig`。
    await this.mount(ctx, { loader: this.loader, profileContext: this.profile });
  }
}
