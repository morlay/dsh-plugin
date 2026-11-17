// 主进程调试端口的**接缝**：开 / 关 / 地址。适配器只有一个（`node:inspector`），测试用假适配器时
// 只要 `InspectorPort` 的这几行——不必真开端口。
//
// 两条硬规矩：
// 1. **只绑 `127.0.0.1`**：调试端口是给本机的 Chrome DevTools 用的，不该出现在局域网上。
// 2. **端口顺延而不是固定**（与 `WebServer` 同一条规矩）：同一台机器常同时开多份，端口冲突不该是错误；
//    因此地址必须回写**真实**端口，否则粘进浏览器会连到别人身上。
import * as nodeInspector from "node:inspector";
import { createServer } from "node:net";

/** 缺省端口（Node 自己的惯例：`--inspect` 也从这个号开始）。 */
export const DEFAULT_INSPECTOR_PORT = 9229;

/** 缺省最多往后试几个端口（顺延的窗口足够吞掉「同时开几份」的冲突）。 */
const DEFAULT_ATTEMPTS = 10;

/** 调试端口只绑回环地址。 */
const LOOPBACK = "127.0.0.1";

/** 打开时能给的参数（测试要能指定端口，真机用缺省）。 */
export interface InspectorOptions {
  /** 起始端口（缺省 {@link DEFAULT_INSPECTOR_PORT}）。 */
  readonly port?: number;
  /** 最多试几个（缺省 10）。 */
  readonly attempts?: number;
}

/** 一次打开的结果。 */
export interface InspectorSession {
  /** 绑的地址（恒为 `127.0.0.1`）。 */
  readonly host: string;
  /** **真实**端口（被占时已顺延，不是请求的那个）。 */
  readonly port: number;
  /** 粘进 Chrome DevTools 的那一条地址。 */
  readonly address: string;
}

/** 主进程调试端口的接缝。 */
export interface InspectorPort {
  /** 此刻开着没有。 */
  readonly opened: boolean;
  /** 地址（关着时没有）。 */
  readonly address: string | undefined;

  /**
   * 打开（已经开着就返回同一次的结果：不重复开）。
   * @param options - 起始端口与顺延窗口。
   * @returns 真实端口与地址。
   * @throws Error 顺延窗口里的端口全被占，或 Node 的 inspector 起不来。
   */
  open(options?: InspectorOptions): Promise<InspectorSession>;

  /**
   * 关掉并释放端口（没开着时什么都不做：退出路径可以无条件调）。
   * @returns 关完。
   */
  close(): Promise<void>;
}

/**
 * `node:inspector` 给的是 `ws://host:port/uuid`，而人能粘的是 DevTools 前端地址。
 * @param websocketUrl - `inspector.url()` 的值。
 * @returns `devtools://devtools/bundled/inspector.html?ws=<host>:<port>/<uuid>`。
 */
export function devtoolsAddressOf(websocketUrl: string): string {
  const marker = "://";
  const at = websocketUrl.indexOf(marker);
  const rest = at === -1 ? websocketUrl : websocketUrl.slice(at + marker.length);
  return `devtools://devtools/bundled/inspector.html?ws=${rest}`;
}

/**
 * 造 `node:inspector` 适配器（真机用；测试的假适配器只需实现 {@link InspectorPort}）。
 * @returns 接缝。
 */
export function nodeInspectorOf(): InspectorPort {
  let session: InspectorSession | undefined;
  return {
    get opened(): boolean {
      return session !== undefined;
    },
    get address(): string | undefined {
      return session?.address;
    },
    async open(options: InspectorOptions = {}): Promise<InspectorSession> {
      if (session !== undefined) return session;
      const port = await freePortOf(options.port ?? DEFAULT_INSPECTOR_PORT, options.attempts ?? DEFAULT_ATTEMPTS);
      try {
        // `wait` 给 false：壳不等调试器接上（没有调试器时也不该卡住启动与菜单）。
        nodeInspector.open(port, LOOPBACK, false);
      } catch (error) {
        throw new Error(`主进程 Inspector 在 ${LOOPBACK}:${String(port)} 上起不来。`, { cause: error });
      }
      const websocketUrl = nodeInspector.url();
      if (websocketUrl === undefined) {
        // 端口在探到与真开之间被别的进程抢走：Node 只打一行 stderr，不抛。
        nodeInspector.close();
        throw new Error(`主进程 Inspector 在 ${LOOPBACK}:${String(port)} 上没起来：端口刚被占用。`);
      }
      session = { host: LOOPBACK, port, address: devtoolsAddressOf(websocketUrl) };
      return session;
    },
    async close(): Promise<void> {
      if (session === undefined) return;
      session = undefined;
      nodeInspector.close();
    },
  };
}

/**
 * 从起始端口往后找一个能绑的。
 * @param start - 起始端口。
 * @param attempts - 最多试几个。
 * @returns 能绑的端口。
 * @throws Error 全被占（调用方据此标灰菜单项并记一行）。
 */
async function freePortOf(start: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset;
    if (await available(port)) return port;
  }
  throw new Error(`${LOOPBACK} 上从 ${String(start)} 起连试 ${String(attempts)} 个端口都被占用。`);
}

/**
 * @param port - 端口。
 * @returns 这个端口此刻能不能绑上 `127.0.0.1`。
 */
function available(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, LOOPBACK, () => {
      server.close(() => resolve(true));
    });
  });
}
