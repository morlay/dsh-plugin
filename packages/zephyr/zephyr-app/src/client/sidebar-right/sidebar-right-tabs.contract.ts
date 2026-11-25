// 右侧面板的 tab 类型注册表（上游右栏行在 apply 里 `ctx.reflect.provide('sidebarRightTabs', …)`）。
//
// 它是**跨行共享注册表**：`ui-sidebar-documentpreview` / `ui-sidebar-terminal` / `ui-sidebar-files` 的行
// 都按类型拿同一份实例。令牌是抽象类并且 `name` 显式对齐上游注册名（`sidebarRightTabs`）：
// 名字只用于对齐上游服务的注册名，读法只有一种——`inject(SidebarRightTabs)`。
//
// 面就是上游那份：内核（kind 占位、band 压制、地址 glob 排序、guide 条目）不重写，实现直接包它
// （deep import 上游 src，仓内先例见 `client/resources/resources.service.ts`）。
import type {
  SidebarRightTabDefinition,
  SidebarRightTabRegistry,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts";
import { Injectable } from "@morlay/zephyr";

/**
 * tab **类型**注册表的令牌面。
 *
 * 正文的注册走另一段（`sidebar.right.pane.tab` 的 keyed 座位），两段用同一个 `id`/key 配对。
 */
@Injectable({ name: "sidebarRightTabs" })
export abstract class SidebarRightTabs {
  /**
   * 内核句柄（上游 `SidebarRightTabRegistry` 实例）。
   *
   * 右栏控制器要拿同一份实例造（`createSidebarRightController(tabs, …)`），所以它必须能从令牌上读到。
   */
  abstract readonly face: SidebarRightTabRegistry;

  /**
   * 注册一条 tab 类型（上游语义：同 kind 的 band 压制、id 唯一、返回注销函数）。
   * @param definition - 类型定义（`id` / `kind` / `title` / `patterns` / …）。
   * @returns 注销函数。
   */
  abstract register(definition: SidebarRightTabDefinition): () => void;

  /**
   * 当前生效的类型清单（按注册顺序，引用稳定）。
   * @returns 每条类型的完整定义。
   */
  abstract entries(): readonly SidebarRightTabDefinition[];

  /**
   * 订阅清单变化（面板的标签条读它）。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  abstract subscribe(listener: () => void): () => void;
}

/** 令牌的实例面（消费方按这个名字写类型时的入口）。 */
export type SidebarRightTabsFace = SidebarRightTabs;
