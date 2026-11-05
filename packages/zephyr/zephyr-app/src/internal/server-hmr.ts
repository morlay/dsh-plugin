// 开发态的**服务端 HMR**：源码变了就重载整棵行树，但**只在服务端空闲时**。
//
// 为什么整树重载而不是模块级热替换：行之间通过令牌/名字互相引用（`inject(SessionStore)` 拿到的是
// **实例**），换掉一个模块而保留别的行，等于让旧行继续握着旧实例——那比直接报错更难查。
// 整树重载的语义清晰：`dispose()` 收干旧树，`bootstrapApplication` 起新树。
//
// 为什么必须等空闲：有在途调用时换树，那条请求会拿到半新半旧的对象图（前半段用旧实例、后半段用新实例）。
// "空闲"的判据分两层：
//   - **传输层**：`MuxServer.inFlight()` 为 0（没有 unary 在跑、没有开着的流）；
//   - **业务层**：调用方给的 `isIdle` 也说空闲（例如没有正在跑的 agent turn）。
import { inject, Injectable, type OnDispose } from "@morlay/zephyr";
import { Logger } from "@morlay/zephyr";
import { MuxServer } from "../api-gateway/mux-server.service.ts";

/** 空闲判据 + 重载动作（由入口提供，`zephyr-app` 不知道应用怎么 bootstrap）。 */
export interface ServerHmrOptions {
  /** 业务层的空闲判据（传输层由 `MuxServer.inFlight()` 自动叠加）。 */
  readonly isIdle?: () => boolean;
  /** 真的要重载时调用，拿到这一轮累积的变化文件（入口负责定位到行并重载）。 */
  readonly reload: (files: readonly string[]) => Promise<void>;
  /** 轮询间隔（毫秒）：文件变化后按这个节奏查空闲。 */
  readonly pollMs?: number;
  /** 等空闲的上限（毫秒）：超时也重载（宁可打断，也别让开发者的改动永远不生效）。 */
  readonly maxWaitMs?: number;
}

/**
 * 收到文件变化后，等空闲再重载一次。
 *
 * 多次变化合并成一次重载：等空闲期间又变了，只延长等待，不排队。
 */
@Injectable()
export class ServerHmr implements OnDispose {
  private readonly mux = inject(MuxServer);

  private readonly logger = inject(Logger);

  private options: ServerHmrOptions | undefined;

  /** 这一轮累积的待重载文件（同一批变化合并）。 */
  private readonly pending = new Set<string>();

  private running: Promise<void> | undefined;

  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 装上空闲判据与重载动作。
   * @param options - 见 {@link ServerHmrOptions}。
   * @returns 撤销函数。
   */
  install(options: ServerHmrOptions): () => void {
    this.options = options;
    return () => {
      this.options = undefined;
    };
  }

  /**
   * 报告"源码变了"。重复调用会合并成一次重载。
   * @param reason - 变化来源（日志用，例如文件路径）。
   */
  /**
   * 报告"源码变了"。重复调用会**合并**成一次重载（同一批变化的文件一起交给 `reload`）。
   * @param files - 变化的源文件绝对路径。
   */
  notify(...files: readonly string[]): void {
    for (const file of files) this.pending.add(file);
    if (files.length > 0) {
      this.logger.info("[server-hmr] 源码变化（%s），等空闲后重载", files.join(", "));
    }
    this.schedule();
  }

  /** 停掉轮询（卸载时调用）。 */
  onDispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.options = undefined;
  }

  /** 开始/继续等空闲。 */
  private schedule(): void {
    if (this.timer !== undefined) return;
    const options = this.options;
    if (options === undefined) return;
    const pollMs = options.pollMs ?? 200;
    const deadline = Date.now() + (options.maxWaitMs ?? 60_000);
    const tick = (): void => {
      this.timer = undefined;
      if (this.pending.size === 0 || this.options === undefined) return;
      const busy = this.mux.inFlight() > 0 || this.options.isIdle?.() === false;
      if (busy && Date.now() < deadline) {
        this.timer = setTimeout(tick, pollMs);
        return;
      }
      if (busy) this.logger.warn("[server-hmr] 等空闲超时，仍然重载");
      const files = [...this.pending];
      this.pending.clear();
      this.running ??= this.reloadOnce(files).finally(() => {
        this.running = undefined;
        // **重载期间又变了**：`notify` 会把它们攒进 `pending`，但那次 `schedule` 因为
        // `timer`/`running` 在忙直接返回——不在这里续一轮，这批变化就永远丢了。
        if (this.pending.size > 0) this.schedule();
      });
    };
    this.timer = setTimeout(tick, pollMs);
  }

  /**
   * 执行一次重载；失败只留痕（开发态不该因为一次重载失败就退出）。
   * @param files - 这一轮累积的变化文件。
   */
  private async reloadOnce(files: readonly string[]): Promise<void> {
    const options = this.options;
    if (options === undefined) return;
    try {
      await options.reload(files);
      this.logger.info("[server-hmr] 重载完成");
    } catch (error) {
      this.logger.error("[server-hmr] 重载失败：%s", String(error));
    }
  }
}
