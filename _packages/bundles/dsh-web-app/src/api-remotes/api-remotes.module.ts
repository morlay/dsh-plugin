// `@deepseek-ai/dsh-api-remotes` 是 **host** 侧插件：它把 Remote 的服务实现接成 gateway 的
// forwarded-event 源（`ctx.typertGateway.registerRemoteEvents(...)`）。放到 client module 里装的话，
// host 的 `remoteEvents` 一直是 undefined，client 的 `/api/remote.mux` 就永远拿不到 ready 帧。
import { Module } from "@morlay/zephyr";
import { ApiRemotes } from "./client/api-remotes.client.service.ts";

@Module({ providers: [ApiRemotes] })
export class ApiRemotesModule {}
