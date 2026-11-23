// 上游会话主视图（client 行）：消息流、输入框、草案、会话头与右侧面板的座位。
//
// 它的 inject 是 7 个名字：`slots` / `sessions` / `fileUpload` / `uiSession` / `uiWorkspace` /
// `locale` / `configForms`。其中 `uiSession`、`uiWorkspace` 是另外两行内部的服务（走令牌发布），
// `fileUpload` 是 upload 域的运行时（`@morlay/dsh-upload/ui` 的契约）：上游的
// `ConversationController` 靠它把粘贴/拖入的图片暂存到宿主（`uploadImage`）。
import * as UiConversationPlugin from "@deepseek-ai/dsh-client-ui-conversation/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, fixedSyncedConfig, Locale, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { UiSession } from "../ui-session.token.ts";
import { UiConversation } from "./conversation.token.ts";
import { FileUpload } from "./conversation.token.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";

@Injectable()
export class ConversationSlots extends fromCordis(
  // **单契约**：`UiConversation`（装配面）。上游 `apply` 里 `ctx.plugin(ConversationController, …)`
  // 在行 ctx 的分层下建出会话控制器，控制器实例由它自己的 fiber 管，不需要我们再立一个令牌。
  UiConversation,
  UiConversationPlugin,
) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly uiSession = inject(UiSession);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly locale = inject(Locale);

  private readonly configForms = inject(ConfigForms);

  private readonly fileUpload = inject(FileUpload);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 0.2.3 起这份 client 的 `Config` 由 Host 同步（`busyEnter` / `maxConcurrentFileUploads`）。
    await this.mount(ctx, fixedSyncedConfig(["busyEnter", "maxConcurrentFileUploads"]), {
      slots: this.slots,
      sessions: this.sessions,
      fileUpload: this.fileUpload,
      uiSession: this.uiSession,
      uiWorkspace: reportedUiWorkspace(this.uiWorkspace),
      locale: this.locale,
      configForms: this.configForms,
    });
  }
}

/**
 * 给上游一份「打开失败会说话」的 `uiWorkspace` 面。
 *
 * 上游 hero 的「选择工作区」在 `ConversationContent` 里是「void selectWorkspace(id).catch(回退 pending)」——
 * 失败被吞掉，界面上只剩「点了没反应」（宿主零请求、控制台零输出，这次排查的成本全在这里）。
 * 这里只包**会拒绝**的那一个入口：拒绝原样抛给调用方（语义不变），另外先打一条带原因的日志。
 * @param face - `uiWorkspace` 契约实例（上游服务）。
 * @returns 同一个面：`openWorkspace` 换成带报告的转发，其余成员随原型链原样可见。
 */
function reportedUiWorkspace(face: UiWorkspace): UiWorkspace {
  return new Proxy(face, {
    get: (target, property, receiver) => {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== "openWorkspace" || typeof value !== "function") return value;
      return (...args: never[]): unknown => {
        const opening: unknown = Reflect.apply(value, target, args);
        if (opening instanceof Promise) {
          void opening.catch((reason: unknown) => {
            console.error(
              "[ui-conversation] 打开工作区失败（上游 hero 会把这条错误吞掉）：",
              reason,
            );
          });
        }
        return opening;
      };
    },
  });
}
