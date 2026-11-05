// 入口失败的兜底记录：**打包形态不把主进程的 stderr 送出去**（参考实现 `prepareShell` 里的那条注释），
// 所以错误必须同时进控制台与一个日志文件，否则人看到的就是「双击没反应」。
//
// **不要用 `app.getPath("logs")`**：它在 ready 之前调用会抛错，而这里恰恰是「启动早期就失败」时用的。
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 日志目录（macOS 的习惯位置；不依赖 Electron 的 app 生命周期）。 */
function logDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Logs", "zephyr-desktop");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? homedir(), "zephyr-desktop", "logs");
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "zephyr-desktop");
}

/**
 * 记一条生命周期事件（**始终落文件**：打包形态没有 stderr，出问题只剩这条线）。
 * @param stage - 阶段名。
 * @param detail - 细节（可选）。
 * @returns 记录完成。
 */
export async function reportEvent(stage: string, detail?: string): Promise<void> {
  try {
    const dir = logDir();
    await mkdir(dir, { recursive: true });
    const line = `${new Date().toISOString()} [event] ${stage}${detail === undefined ? "" : ` ${detail}`}\n`;
    await appendFile(join(dir, "shell-entry.log"), line, "utf8");
  } catch {
    // 落不了盘就算了：事件日志不是功能。
  }
}

/**
 * 记录一次入口失败。
 * @param stage - 阶段名（`引导` / `加载入口` / `启动`），用来区分崩在哪一段。
 * @param error - 抛出来的东西。
 * @returns 记录完成。
 */
export async function reportFailure(stage: string, error: unknown): Promise<void> {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[zephyr-shell] ${stage}失败:`, text);
  try {
    const dir = logDir();
    await mkdir(dir, { recursive: true });
    await appendFile(
      join(dir, "shell-entry.log"),
      `${new Date().toISOString()} ${stage} ${text}\n`,
      "utf8",
    );
  } catch {
    // 连日志目录都写不了：控制台那一行已经是最后的线索。
  }
}
