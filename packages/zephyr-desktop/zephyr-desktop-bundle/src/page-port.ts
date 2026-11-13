// 页面端口：**origin 就是存储身份**，所以端口要粘住（契约第 6 条 / T9）。
//
// 页面存储（`localStorage` 与页面 shim 的 IndexedDB）按 origin 分区：端口每次随机 = 每次换一个浏览器 =
// 前端缓存每次读不到。这里把上次用过的端口记在 `<userData>/page-port`（与 userData 同生命周期：
// 删它等于让用户丢一次页面存储，所以不能放可整删的缓存目录）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

/** 端口文件名（在 `userData` 下）。 */
export const PAGE_PORT_FILE = "page-port";

/** 首次兜底的端口（与宿主 `WebServer` 的缺省一致）。 */
const DEFAULT_PORT = 3080;

/** 可用端口的下界：1024 以下是系统保留段。 */
const MIN_PORT = 1024;

/** 可用端口的上界。 */
const MAX_PORT = 65535;

/** 探测与选取端口的外界动作（测试换替身，平时就是本文件的实现）。 */
export interface PortActions {
  /** 端口现在能不能绑。 */
  readonly probe?: (port: number) => Promise<boolean>;
  /** 重新探一个空闲端口（只作首次兜底）。 */
  readonly pick?: () => Promise<number>;
}

/**
 * 解析端口文件（坏内容当「没有」：文件是上一个进程写的，形状不可信）。
 * @param raw - 文件内容。
 * @returns 端口，或 `undefined`。
 */
export function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (!/^\d+$/u.test(text)) return undefined;
  const value = Number(text);
  return value >= MIN_PORT && value <= MAX_PORT ? value : undefined;
}

/**
 * 读上次记下的端口。
 * @param userData - `userData` 目录。
 * @returns 端口，或 `undefined`（没有 / 坏内容）。
 */
export async function preferredPortOf(userData: string): Promise<number | undefined> {
  return parsePort(await readFile(join(userData, PAGE_PORT_FILE), "utf8").catch(() => undefined));
}

/**
 * 记下这次用的端口（写不了就算了：下次重新探一个）。
 * @param userData - `userData` 目录。
 * @param port - 端口。
 * @returns 写完成。
 */
export async function rememberPort(userData: string, port: number): Promise<void> {
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, PAGE_PORT_FILE), `${String(port)}\n`, "utf8").catch(
    () => undefined,
  );
}

/**
 * 端口能不能绑（能绑 = 现在没人占）。
 * @param port - 端口。
 * @returns 判断结果。
 */
export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => done(true));
    });
  });
}

/**
 * 探一个空闲端口（**只作首次兜底**：它会让 origin 变化）。
 * @returns 端口。
 */
export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : DEFAULT_PORT;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * 这次的页面端口：**上次用过的那个**（origin 因此不变），被占用才重新探一个并写回。
 *
 * `--port` 显式给了就不走这里（显式值不写回——它是一次性的，不该把端口偏好搬走）。
 * @param userData - `userData` 目录（端口文件在这里）。
 * @param actions - 探测与选取动作（测试可换替身）。
 * @returns 端口。
 */
export async function stickyPort(userData: string, actions: PortActions = {}): Promise<number> {
  const probe = actions.probe ?? isPortFree;
  const pick = actions.pick ?? freePort;
  const preferred = await preferredPortOf(userData);
  if (preferred !== undefined && (await probe(preferred))) return preferred;
  const port = await pick();
  await rememberPort(userData, port);
  return port;
}
