// 工作区配置：`zephyr.config.ts` 的**唯一**配置面。
//
// 它描述的是「这个工作区是什么」（入口、桌面身份、数据目录、要追加哪些插件），
// 而不是「CLI 有哪些命令」——核心命令永远存在，help 永远稳定。
import { InjectionToken, type ProviderList } from "@morlay/zephyr";
import type { ZephyrLayout } from "../layout.ts";

/** 服务端入口：那个文件默认导出一份 provider 清单（应用装全，CLI 只 bootstrap）。 */
export interface ZephyrServerConfig {
  /** 相对配置文件或绝对路径。 */
  readonly entry: string;
  /**
   * 产物根：相对配置文件或绝对路径；缺省 `target/<应用名>/`。
   *
   * 产物是「可分发的一份应用」（设计决定 3）：落哪归应用配置，与 vite 的 `build.outDir` 同一习惯。
   * 它的形状见 {@link ZephyrLayout}：`client_modules/` / `node_modules/` / `src/server.ts` /
   * `bootstrap.mjs` / `package.json`。
   */
  readonly outputDir?: string;
}

/** 客户端入口：**页面那一个文件**（vite 的 `root` 是它的目录、`input` 是它自己）。 */
export interface ZephyrClientConfig {
  /** 页面入口 `index.html`（相对配置文件）。 */
  readonly entry: string;
  /** 额外 vite 插件（框架层的联邦、样式插件由应用给）。 */
  readonly plugins?: readonly unknown[];
  /**
   * 构建用的 **vite 配置片段**（内联对象，不是文件路径）。
   *
   * 静态面的解析规则（alias / define / 装饰器模式）住框架层，CLI 不复制它们：应用在这里展开一次
   * （`vite: zephyrClientViteConfig({ repoRoot })`），CLI 把自己的 `outDir` / root / 入口叠上去。
   * 不占一个 `vite.config.ts` 文件——配置只有一个 home。
   */
  readonly vite?: Readonly<Record<string, unknown>>;
}

/**
 * dev 形态的开关（`zephyr dev` 与 `desktop dev` 读同一份）。
 *
 * 这些是"排查时想暂时拿掉的东西"，不是形态：形态由 `packaged` 说，开关只影响开发期那两半 HMR。
 */
export interface ZephyrDevConfig {
  /**
   * HMR 的两半开关：**客户端**（vite 热更）与**服务端**（等空闲后换树）。
   *
   * 缺省都开；环境变量 `ZEPHYR_HMR_CLIENT` / `ZEPHYR_HMR_SERVER` 覆盖这里的值
   * （`0|false|off|no` 关，`1|true|on|yes` 开）——临时排查不必改文件。
   */
  readonly hmr?: {
    readonly client?: boolean;
    readonly server?: boolean;
  };
}

/** HMR 两半的**生效值**（配置 ⊕ 环境变量）：CLI 把它交给 `devProviders()`。 */
export interface HmrSwitches {
  readonly client: boolean;
  readonly server: boolean;
}

/** 桌面身份（只有装了桌面插件才用到）。 */
export interface ZephyrDesktopConfig {
  /** 反向域名形式的应用 id。 */
  readonly id: string;
  /** 显示名。 */
  readonly name: string;
  /** 图标（svg/png，相对配置文件）。 */
  readonly icon?: string;
  /** 窗口初始尺寸。 */
  readonly window?: {
    readonly width: number;
    readonly height: number;
    readonly minWidth?: number;
    readonly minHeight?: number;
  };
}

/**
 * 一份工作区配置。
 *
 * 插件是**内联展开**的清单条目（`plugins: [...provideDesktopBundle({...})]`）：装的什么、
 * 命令从哪来，在这张表上一眼看得到，不需要再维护一份包名字符串。
 */
export interface ZephyrConfig {
  readonly server: ZephyrServerConfig;
  readonly client: ZephyrClientConfig;
  readonly desktop?: ZephyrDesktopConfig;
  /** dev 形态的开关（HMR 的两半）。 */
  readonly dev?: ZephyrDevConfig;
  /** 数据目录三态：`workspace`（缺省，`<profileDir>/.dsh-store`）/ `xdg` / 绝对路径。 */
  readonly dataDir?: string;
  /** 追加到 CLI 命令树的插件清单。 */
  readonly plugins?: ProviderList;
}

/** 解析后的配置：绝对路径 + 布局。 */
export interface ResolvedConfig {
  readonly config: ZephyrConfig;
  /** 配置文件绝对路径。 */
  readonly configFile: string;
  /** 工作区（配置文件所在目录）。 */
  readonly workspace: string;
  /** 产物布局。 */
  readonly layout: ZephyrLayout;
  /** 服务端入口绝对路径。 */
  readonly serverEntry: string;
  /** 客户端入口绝对路径（页面 `index.html`）。 */
  readonly clientEntry: string;

  /** 应用名（产物根的缺省目录名与 `xdg` 数据目录都用它；取 `desktop.name` 或工作区目录名）。 */
  readonly appName: string;
  /**
   * HMR 两半的**生效值**（`dev.hmr` 配置 ⊕ 环境变量）。
   *
   * 合成只在这里做一次：命令（`dev`）读它交给 `devProviders()`，不必各自再算一遍优先级。
   */
  readonly hmr: HmrSwitches;
}

/** 解析后的配置值令牌：命令读它拿入口与布局，不必再自己找配置。 */
export const Workspace = InjectionToken<ResolvedConfig>("workspace");
