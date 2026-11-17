// **开发面动作**：菜单点一下之后发生什么——这一层只依赖两个接缝（`DevMode` / `InspectorPort`），
// 不碰 electron。`app.ts` 因此只剩「画菜单、拿剪贴板」这几行，规则都在这儿，也都在测试里。
//
// 三条不变量（设计决定 6 与验收 4 / 5）：
// 1. 关开发者模式 → 关掉 Inspector（不然端口留在那儿）；
// 2. 退出 → 关掉 Inspector（`lsof` 里不该还有监听）；
// 3. Inspector 打不开 → 记一行 + 菜单项标灰，不弹窗、不退出、不抛到菜单点击外面。
import type { DevMode } from "./dev-mode.ts";
import type { InspectorPort } from "./inspector.ts";
import type { InspectorMenuState } from "./menu.ts";

/** 造开发面动作要的东西。 */
export interface DevToolsInput {
  /** 开发者模式（状态在它里面，这里只读写）。 */
  readonly devMode: DevMode;
  /** 主进程调试端口。 */
  readonly inspector: InspectorPort;
  /** 记一行到 `shell-entry.log`（打包形态没有 stderr，只剩这条线）。 */
  readonly report: (stage: string, detail?: string) => Promise<void>;
  /** 状态变了 → 重画菜单（不重开窗口）。 */
  readonly onChange: () => void;
}

/** 菜单与退出要用到的开发面。 */
export interface DevTools {
  /** 开发者模式此刻的状态（菜单据此收起或展开开发项）。 */
  readonly enabled: boolean;
  /** Inspector 在菜单里的样子（勾选 / 地址 / 标灰）。 */
  readonly inspector: InspectorMenuState;

  /**
   * 点「开发者模式」：翻转并持久化；关的时候先关掉 Inspector。
   * @returns 完事（落盘失败只记一行，不改状态：菜单已经重画过了）。
   */
  toggleDevMode(): Promise<void>;

  /**
   * 点「打开主进程 Inspector」：开或关；打不开就标灰并记一行。
   * @returns 完事。
   */
  toggleInspector(): Promise<void>;

  /**
   * 退出：关掉 Inspector（没开就什么都不做）。
   * @returns 关完。
   */
  dispose(): Promise<void>;
}

/**
 * 造开发面动作。
 * @param input - 两个接缝 + 日志 + 重画回调。
 * @returns 菜单与退出要用的那几件事。
 */
export function devToolsOf(input: DevToolsInput): DevTools {
  /** Inspector 打不开过一次（菜单项标灰；下次切换时清掉，允许再试）。 */
  let failed = false;

  /**
   * 关掉 Inspector 并记一行（没开着就什么都不做：退出路径可以无条件调）。
   * @param stage - 日志阶段名。
   * @returns 关完。
   */
  const closeInspector = async (stage: string): Promise<void> => {
    if (!input.inspector.opened) return;
    await input.inspector.close();
    await input.report(stage);
  };

  // 开发者模式自己的切换（菜单点、或将来别处写）都让菜单跟着重画。
  input.devMode.onChange(() => {
    input.onChange();
  });

  return {
    get enabled(): boolean {
      return input.devMode.enabled;
    },
    get inspector(): InspectorMenuState {
      const address = input.inspector.address;
      return {
        opened: input.inspector.opened,
        ...(address === undefined ? {} : { address }),
        ...(failed ? { failed: true } : {}),
      };
    },
    async toggleDevMode(): Promise<void> {
      const next = !input.devMode.enabled;
      // 先收端口再改状态：菜单重画（`onChange`）那一刻看到的就已经是关掉的样子。
      if (!next) await closeInspector("开发者模式关闭：已收起主进程 Inspector");
      failed = false;
      await input.devMode.set(next).catch((error: unknown) =>
        input.report("写开发者模式标记", messageOf(error)),
      );
    },
    async toggleInspector(): Promise<void> {
      if (input.inspector.opened) {
        await input.inspector.close();
        await input.report("主进程 Inspector 已关闭");
        input.onChange();
        return;
      }
      try {
        const session = await input.inspector.open();
        failed = false;
        await input.report("主进程 Inspector 已打开", session.address);
      } catch (error) {
        failed = true;
        await input.report("主进程 Inspector 打不开", messageOf(error));
      }
      input.onChange();
    },
    async dispose(): Promise<void> {
      await closeInspector("退出：已收起主进程 Inspector");
    },
  };
}

/**
 * @param error - 抛出来的东西。
 * @returns 一行原因（日志里不写堆栈：端口占用的原因本来就一句话）。
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
