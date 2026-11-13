// 页面端口：**origin 就是存储身份**，所以端口要粘住，而且**不许悄悄换**。
//
// 页面存储（`localStorage` 与页面 shim 的 IndexedDB）按 origin 分区：端口一换就是换一个浏览器。
// 因此规则是「记住的那个端口被外部进程占着 → 报错并给出口」，只有「第一次」与「记录损坏」才重新选。
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

/** 端口从哪来。 */
export type PortSource = "remembered" | "fresh" | "corrupt" | "explicit";

/** 端口选择的结果：要么定下端口，要么与外部占用冲突（冲突时**不自动换**）。 */
export type PortChoice =
  | { readonly kind: "ok"; readonly port: number; readonly source: PortSource }
  | { readonly kind: "conflict"; readonly port: number };

/** 选择端口的输入。 */
export interface PortInput {
  /** `userData` 目录（端口文件在这里）。 */
  readonly userData: string;
  /** `--port` 的显式值：它就是新的 origin 归属，会被**写回**。 */
  readonly explicit?: number | undefined;
  /** 端口现在能不能绑（测试可换替身）。 */
  readonly probe?: (port: number) => Promise<boolean>;
  /** 重新探一个空闲端口（只在首次 / 记录损坏时用）。 */
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
  return (await portRecordOf(userData)).port;
}

/**
 * 记下这个端口（写不了就算了：下次重新探一个）。
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
 * 这次该用哪个端口。
 *
 * 三条规矩：① `--port` 显式值优先，**写回**（用户显式选的 origin 就是新的归属）；② 记住的端口空着
 * 就用它；③ 被外部进程占着就报冲突（返回 `conflict`，由调用方抛可操作的错误），**不自动换**——换了
 * 等于把页面存储另起一份。只有「没有记录」与「记录损坏」才重新选并写回。
 * @param input - `userData`、显式值与替身动作。
 * @returns 选好的端口，或冲突。
 */
export async function portFor(input: PortInput): Promise<PortChoice> {
  const probe = input.probe ?? isPortFree;
  const pick = input.pick ?? freePort;
  if (input.explicit !== undefined) {
    await rememberPort(input.userData, input.explicit);
    return { kind: "ok", port: input.explicit, source: "explicit" };
  }
  const record = await portRecordOf(input.userData);
  if (record.port !== undefined) {
    if (await probe(record.port)) return { kind: "ok", port: record.port, source: "remembered" };
    return { kind: "conflict", port: record.port };
  }
  const port = await pick();
  await rememberPort(input.userData, port);
  return { kind: "ok", port, source: record.corrupt ? "corrupt" : "fresh" };
}

/**
 * 端口冲突时给用户的可操作提示（三条出口，都写明代价）。
 * @param input - 被占的端口与 `userData` 目录。
 * @returns 多行提示。
 */
export function portConflictHint(input: {
  readonly port: number;
  readonly userData: string;
}): string {
  const file = join(input.userData, PAGE_PORT_FILE);
  return [
    `页面端口 ${String(input.port)}（记在 ${file}）被别的进程占着。`,
    "不自动换端口：换了 origin，页面存储（localStorage / IndexedDB）会另起一份。三条出口：",
    `  · 关掉占用它的进程：lsof -nP -iTCP:${String(input.port)} -sTCP:LISTEN`,
    `  · 换端口重起：zephyr desktop dev --port <新端口>（origin 会变，页面存储另起一份）`,
    `  · 换一份 userData（并行多个工作区时就这么办）：zephyr desktop dev --user-data-dir <目录>`,
  ].join("\n");
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
 * 探一个空闲端口（**只在首次 / 记录损坏时用**：它会让 origin 变化）。
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
 * 读端口记录：区分「没有文件」与「文件在但坏了」。
 * @param userData - `userData` 目录。
 * @returns 端口（可能没有）与「是否损坏」。
 */
async function portRecordOf(userData: string): Promise<{ port?: number; corrupt: boolean }> {
  const raw = await readFile(join(userData, PAGE_PORT_FILE), "utf8").catch(() => undefined);
  if (raw === undefined) return { corrupt: false };
  const port = parsePort(raw);
  return port === undefined ? { corrupt: true } : { port, corrupt: false };
}
