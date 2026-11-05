// 资源模型契约：令牌按服务语义命名（上游注册名 `resources`）。
//
// 成员从上游 `Resources` 接口推导（`register`/`pin`/`source`/…），实现由 `ResourcesDefault` 组合
// `ResourceRegistry` 提供。
import type { Resources as UpstreamResources } from "@deepseek-ai/dsh-client-resources/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Resources {
  abstract register(provider: Parameters<UpstreamResources["register"]>[0]): () => void;

  abstract pin(address: Parameters<UpstreamResources["pin"]>[0], signal: Parameters<UpstreamResources["pin"]>[1]): void;

  abstract source(address: Parameters<UpstreamResources["source"]>[0]): ReturnType<UpstreamResources["source"]>;
}
