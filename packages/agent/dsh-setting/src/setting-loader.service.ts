// 配置文档的**唯一 IO 出口**：启动读一次、每次写回串行落盘、卸载时等到队列清空。
//
// `SettingDefault` 只管内存文档；落盘的并发、失败可见与退出 flush 都在这里。写盘失败不再被吞掉
// （`void writeFile(...).catch(() => undefined)` 是「重启后丢了」最难查的形态）：串行队列 + `console.error`。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import type { SettingDocument } from "./contract/setting.contract.ts";

@Injectable()
export class SettingLoader implements OnInit, OnDispose {
  private readonly env = inject(AppEnv);

  /** 启动时读到的文档（文件不存在就是 `undefined`，调用方按空文档处理）。 */
  private loaded: SettingDocument | undefined;

  /** 串行队列：上一次落盘结束（成功或已记录失败）后才开始下一次。 */
  private queue: Promise<void> = Promise.resolve();

  async onInit(): Promise<void> {
    const text = await readFile(this.path, "utf8").catch(() => undefined);
    this.loaded = text === undefined ? undefined : (JSON.parse(text) as SettingDocument);
  }

  /**
   * 启动时读到的文档。
   * @returns 磁盘上的文档；没有文件时 `undefined`。
   */
  initial(): SettingDocument | undefined {
    return this.loaded;
  }

  /**
   * 把整份文档排进写盘队列（2 空格缩进 + 末尾换行，人可读、可手改）。
   * @param document - 要落盘的文档快照。
   */
  save(document: SettingDocument): void {
    const text = `${JSON.stringify(document, null, 2)}
`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, text, "utf8");
      })
      .catch((error: unknown) => {
        // 事实型观测：写盘失败的原始错误，不吞。
        console.error(`[settings] 写盘失败（${this.path}）：`, error);
      });
  }

  /** 卸载时等到队列清空（未落盘的写不会丢在进程退出里）。 */
  async onDispose(): Promise<void> {
    await this.queue;
  }

  /** 文档路径：数据根下的 `settings.json`（与 sessions / credentials 同一层）。 */
  private get path(): string {
    return join(this.env.values.dataDir, "settings.json");
  }
}
