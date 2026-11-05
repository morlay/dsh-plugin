// resources 行：**只提供服务**（`Resources` 契约面），不碰 slot。
//
// slot 的贡献是 UI 的事（`resources.contribution.ts` 的 `@Slot`）——服务与组件分开，
// 与 Angular 的「service 不做模板贡献」同一条边界。
import { ResourceRegistry } from "@deepseek-ai/dsh-client-resources/src/client/resources.ts";
import { Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Resources } from "./resources.contract.ts";

@Injectable()
export class ResourcesDefault extends Resources implements OnInit {
  private registry: ResourceRegistry | undefined;

  onInit(ctx: Context): void {
    this.registry = new ResourceRegistry({ effect: ctx.effect.bind(ctx) } as never);
  }

  private get core(): ResourceRegistry {
    if (this.registry === undefined) throw new Error("resources 未初始化：装配顺序错误");
    return this.registry;
  }

  register(provider: Parameters<Resources["register"]>[0]): () => void {
    return this.core.register(provider as never);
  }

  pin(address: string, signal: AbortSignal): void {
    this.core.pin(address, signal);
  }

  source(address: string): ReturnType<Resources["source"]> {
    return this.core.source(address) as ReturnType<Resources["source"]>;
  }
}
