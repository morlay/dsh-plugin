// 壳的**开发者模式**：一个可切的运行时状态，不是只读值。
//
// 为什么可变：打包形态从 Finder 双击启动时既没有环境变量也没有启动参数，「打包后能开」只能靠应用内入口。
// 三源合并（`ZEPHYR_DESKTOP_DEBUG=1` / `--debug` / userData 下的 `debug` 标记）、持久化与订阅都收在
// 这一处——删掉它，这三件事会散到 `app.ts` 与 `menu.ts` 各写一遍。
//
// 标记文件是**唯一**的持久化形态（不是配置项）：`touch <userData>/debug` 与菜单里点一下是同一件事。
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** userData 下那个标记文件的名字（内容不重要，在就是开）。 */
export const DEV_MODE_MARKER = "debug";

/** 造开发者模式要的部署值。 */
export interface DevModeInput {
  /** userData：标记文件写在这里（位置不归壳算，由 `zephyr-desktop-bundle` 递进来）。 */
  readonly userData: string;
  /** 环境变量（缺省 `process.env`）：`ZEPHYR_DESKTOP_DEBUG=1` 即开。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 启动参数（缺省 `process.argv`）：含 `--debug` 即开。 */
  readonly argv?: readonly string[];
}

/** 开发者模式：三源合并的结果 + 唯一的运行期写口。 */
export interface DevMode {
  /** 此刻是不是开发者模式。 */
  readonly enabled: boolean;

  /**
   * 切换并持久化（开=写标记，关=删标记），订阅者**先**收到新值再落盘。
   *
   * 顺序是有意的：菜单要即时重画，磁盘写失败不该让界面卡在旧状态上——落盘失败由调用方记一行。
   * @param enabled - 目标状态（与当前相同则什么都不做）。
   * @returns 落盘完成。
   */
  set(enabled: boolean): Promise<void>;

  /**
   * 订阅切换（菜单据此重画，不必重开窗口）。
   * @param listener - 收到切换后的值。
   * @returns 退订。
   */
  onChange(listener: (enabled: boolean) => void): () => void;
}

/**
 * 合并三个来源造出开发者模式。
 * @param input - userData 与（可注入的）env / argv。
 * @returns 开发者模式（之后由菜单写入，见 {@link DevMode.set}）。
 */
export async function devModeOf(input: DevModeInput): Promise<DevMode> {
  const marker = join(input.userData, DEV_MODE_MARKER);
  const listeners = new Set<(enabled: boolean) => void>();
  let enabled =
    (await existsOf(marker)) ||
    (input.argv ?? process.argv).includes("--debug") ||
    (input.env ?? process.env).ZEPHYR_DESKTOP_DEBUG === "1";
  return {
    get enabled(): boolean {
      return enabled;
    },
    async set(next: boolean): Promise<void> {
      if (next === enabled) return;
      enabled = next;
      // 快照一份：订阅者在回调里退订不该漏掉后面的人。
      for (const listener of Array.from(listeners)) listener(next);
      await (next ? writeFile(marker, "", "utf8") : rm(marker, { force: true }));
    },
    onChange(listener: (enabled: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 标记文件在不在（读不出内容也算在：`touch` 出来的就是空文件）。
 * @param path - 标记文件。
 * @returns 在不在。
 */
async function existsOf(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}
