// 右侧面板的对外动作面（上游右栏行发布的服务：`ctx.sidebarRight`）。
//
// 为什么在框架 app：右侧栏是**应用框架的位**（与 `Layout` / `Theme` / `Slots` 同层），不是某个业务域的
// 概念——会话、工作区、技能、终端几个域的 UI 行都要装进去。
//
// 令牌是**抽象类**（不是 `InjectionToken`）：`name` 显式对齐上游服务名（`sidebarRight`），
// 实现只能 `extends` 这份契约，成员缺一个就编译不过。
//
// 面取上游**控制器**（`ctx.sidebarRight` 的运行期类型），不是窄接口 `ISidebarRight`：上游行实际按控制器面
// 用（`openTabIn` / `tabDomain` / `menuTabs` …），契约只列窄接口会让那些读法落空。
// 只声明我们实现与消费的那部分，全量覆盖由下面的守卫与上游面比对。
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app";
import type {
  SidebarRightController,
  SidebarRightSurfaceStore,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts";

/** `ctx.sidebarRight` 的面：上游控制器。 */
export type SidebarRightFace = SidebarRightController;

/** `ctx.sidebarRight`：面见 {@link SidebarRightFace}。 */
@Injectable({ name: "sidebarRight" })
export abstract class SidebarRight {
  /** 当前在屏的会话（没有会话在屏时是 `undefined`）。 */
  abstract readonly mounted: SidebarRightFace["mounted"];

  /** 打开一个资源：占位、放置、露出右栏、记录导航。 */
  abstract readonly openResource: SidebarRightFace["openResource"];

  /** 按已注册的 tab 类型打开临时内容。 */
  abstract readonly openContent: SidebarRightFace["openContent"];

  /** 按页面类型打开。 */
  abstract readonly openTab: SidebarRightFace["openTab"];

  /** 关掉在屏会话的一个 tab。 */
  abstract readonly close: SidebarRightFace["close"];

  /** 藏一个 tab（收起浮动或折叠停靠列）。 */
  abstract readonly hide: SidebarRightFace["hide"];

  /** 当前面板的活动 tab。 */
  abstract readonly active: SidebarRightFace["active"];

  /** 面板是否展开。 */
  abstract readonly isExpanded: SidebarRightFace["isExpanded"];

  /** 折叠 / 展开（并聚焦活动停靠页）。 */
  abstract readonly toggleExpanded: SidebarRightFace["toggleExpanded"];

  /** 聚焦一个 tab 与它所在的页。 */
  abstract readonly focus: SidebarRightFace["focus"];

  /** 一个 tab 的「全部 / 右侧 / 能否关」（右键菜单按它算）。 */
  abstract readonly menuTabs: SidebarRightFace["menuTabs"];

  /** 某个会话最近一次「让 pane 发光」的请求（上游座位把它当动画源）。 */
  abstract readonly flashOf: SidebarRightFace["flashOf"];

  /** 按会话关一个 tab（右键菜单的关闭动作走它）。 */
  abstract readonly closeIn: SidebarRightFace["closeIn"];

  /** tab 域：每个 tab 记录的导航与生命周期（容器绑 `keyedHooks.tabNavigation` 读它）。 */
  abstract readonly tabDomain: SidebarRightFace["tabDomain"];
}

/**
 * 形状守卫：契约声明的每个成员都必须在上游面上（签名一致）。
 *
 * **为什么不 `implements`**：契约**只覆盖一部分**——它声明的是我们实现/消费的 12 个成员；上游控制器还有
 * 一整套 pane 体系（`split` / `float` / `dock` / `tabsIn` / `canCloseTarget` / `flashOf` …）没有消费方，
 * 不进契约。`implements` 会因为这些缺口报一堆"缺属性"，掩盖真正的问题。
 * 注意方向：这里把**契约**当上游传（`AssertCoveredStrict<SidebarRight, SidebarRightFace>`）——判的是
 * 「契约声明的每个成员都在上游面上」。
 */
export type SidebarRightCovered = AssertTrue<
  AssertCoveredStrict<SidebarRight, SidebarRightFace>
>;

/**
 * **我们这层**的扩展面（不伪装成上游成员，所以不参与上面的守卫）。
 *
 * 容器要给 `rightbar.session` 声明 `store`，而那份实例必须是控制器 `adopt` 过的那一份；「按会话懒建并
 * 交给控制器 adopt」是本层的能力，上游控制器面里没有它。
 */
export interface SidebarRightSurfaces {
  /**
   * 某个会话的 surface（控制器 adopt 的那一份 store；第一次要就建出来并 adopt）。
   * @param sessionId - 会话 id。
   * @returns 该会话的 store 实例。
   */
  surfaceOf(sessionId: string): SidebarRightSurfaceStore | undefined;
}

/**
 * 装配行注入的**完整契约**：上游段（`SidebarRight`）+ 本层段（`SidebarRightSurfaces`）。
 *
 * 两段分开写，让「哪些成员来自上游、哪些是本层新增」在类型上直接可读；实现类只能 `extends` 它。
 */
export abstract class SidebarRightRow extends SidebarRight implements SidebarRightSurfaces {
  /** 某个会话的 surface（见 {@link SidebarRightSurfaces.surfaceOf}）。 */
  abstract surfaceOf(sessionId: string): SidebarRightSurfaceStore | undefined;
}
