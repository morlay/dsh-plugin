// 右栏的 **tab 类型注册表**实现：直接用上游那份（`SidebarRightTabRegistry`）。
//
// 上游的注册表是内部件、没从 `/client` 导出，但语义（kind 占位、band 压制、地址 glob 排序、guide 条目）
// 不是我们该抄的——抄一遍就是第二份内核。deep import 上游 src 的先例见
// `client/resources/resources.service.ts` 与 `dsh-client-ui-workspace/src/client/tree.ts`。
import {
  SidebarRightTabRegistry,
  type SidebarRightTabDefinition,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts";
import { Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** `ctx.sidebarRightTabs` 的实现：包一份上游注册表（注册的生命周期跟着本行的 `ctx`）。 */
@Injectable()
export class SidebarRightTabsDefault extends SidebarRightTabs implements OnInit {
  /** 上游注册表：`onInit` 拿到 ctx 之后才建（它的 `register` 要往本行挂 effect）。 */
  private instance: SidebarRightTabRegistry | undefined;

  /**
   * 建注册表。
   * @param ctx - 本行的上下文（注册项的效果挂在这里）。
   */
  onInit(ctx: Context): void {
    this.instance = new SidebarRightTabRegistry(ctx);
  }

  get face(): SidebarRightTabRegistry {
    if (this.instance === undefined) {
      throw new Error("sidebarRightTabs 未初始化：装配顺序错误（onInit 之前被调用）");
    }
    return this.instance;
  }

  /**
   * 注册一条 tab 类型（上游语义原样转发）。
   * @param definition - 类型定义。
   * @returns 注销函数。
   */
  register(definition: Parameters<SidebarRightTabs["register"]>[0]): () => void {
    return this.face.register(definition);
  }

  /**
   * 当前生效的类型清单。
   * @returns 上游注册表的稳定引用。
   */
  entries(): readonly SidebarRightTabDefinition[] {
    return this.face.entries();
  }

  /**
   * 订阅清单变化。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void {
    return this.face.subscribe(listener);
  }
}
