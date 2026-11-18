// `UserQuestionsEndpoint` 的**客户端形态**：只消费、不实现。
//
// 消费方调契约方法（`client.answer({ agent, callId, answer })`），不再拼 `"userQuestions/answer"`
// 这种 wire 名——名字的唯一 home 是契约上的 `@RemoteGroup` / `@RemoteMethod`。
//
// `@RemoteClient()` 负责两件事：注册成 provider、给契约里声明的每个方法生成转发
// （`remote.invoke("<group>/<method>", { request })`，见 `zephyr-app` 的 `defineForwarder`）。
// 组名从契约继承，这里不写；方法体也不用写。
//
// `remote` 字段在这里显式声明：契约类**不**继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { inject } from "@morlay/zephyr";
import { RemoteClient } from "@morlay/zephyr-app/remote";
import { Remote } from "@morlay/zephyr-app/client";
import { UserQuestionsEndpoint } from "../endpoint/user-questions-endpoint.ts";

/** `userQuestions` 组的客户端契约实例。 */
@RemoteClient()
export class UserQuestionsEndpointClient extends UserQuestionsEndpoint {
  /** 转发目标：`remote.invoke("<group>/<method>", { request })`。 */
  protected readonly remote = inject(Remote);
}
