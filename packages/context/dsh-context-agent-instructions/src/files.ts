import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** 一条要注入的指令文件：`display` 进 id 与正文，`path` 用来读。 */
export interface InstructionFile {
  readonly display: string;
  readonly path: string;
}

export interface WorkspaceOptions {
  readonly instructionFileCandidates: readonly string[];
  readonly localInstructionFileCandidates: readonly string[];
  readonly dshHome: string;
}

/** 从 cwd 逐级向上找项目根（含标记目录的那一级）。 */
async function projectRoot(cwd: string, marker = ".git"): Promise<string | undefined> {
  let current = resolve(cwd);
  for (;;) {
    const found = await stat(join(current, marker)).then(
      () => true,
      () => false,
    );
    if (found) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function abbreviateHome(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * 工作区指令链：用户全局 `$DSH_HOME/AGENTS.md`，再从项目根到 cwd 的每一级目录取
 * 基础文件与本地 overlay。顺序由宽泛到具体——具体的在后面，与"更具体的优先"一致。
 */
export async function instructionChain(
  cwd: string,
  options: WorkspaceOptions,
): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const global = join(options.dshHome, "AGENTS.md");
  if (await isFile(global)) files.push({ display: abbreviateHome(global), path: global });

  const root = (await projectRoot(cwd)) ?? resolve(cwd);
  const levels: string[] = [];
  let current = resolve(cwd);
  for (;;) {
    levels.unshift(current);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const level of levels) {
    for (const name of [
      ...options.instructionFileCandidates,
      ...options.localInstructionFileCandidates,
    ]) {
      const path = join(level, name);
      if (await isFile(path)) files.push({ display: relativeDisplay(root, path), path });
    }
  }
  return files;
}

function relativeDisplay(root: string, path: string): string {
  const rel = path.slice(root.length + 1);
  return rel.length === 0 ? path : rel;
}

async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).then(
    (value) => value,
    () => undefined,
  );
  return info?.isFile() === true;
}

/** 读一个指令文件；按 `mtimeMs:size` 缓存，未变就不重读。 */
export async function readInstruction(
  file: InstructionFile,
  cache: Map<string, { stamp: string; text: string }>,
  maxBytes: number,
): Promise<string> {
  const info = await stat(file.path).then(
    (value) => value,
    () => undefined,
  );
  if (info?.isFile() !== true) {
    cache.delete(file.path);
    return "";
  }
  const stamp = `${String(info.mtimeMs)}:${String(info.size)}`;
  const cached = cache.get(file.path);
  if (cached?.stamp === stamp) return cached.text;
  const raw = await readFile(file.path, "utf8").catch(() => "");
  const text = budget(raw, file.display, maxBytes);
  cache.set(file.path, { stamp, text });
  return text;
}

/** 单文件超出预算时截断并留一行可见提示（不静默丢内容）。 */
function budget(text: string, display: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text.trimEnd();
  const kept = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  const lastBreak = kept.lastIndexOf("\n");
  const body = (lastBreak > 0 ? kept.slice(0, lastBreak) : kept).trimEnd();
  return `${body}\n\n(Workspace instruction budget ${String(maxBytes)} bytes: ${display} is truncated.)`;
}
