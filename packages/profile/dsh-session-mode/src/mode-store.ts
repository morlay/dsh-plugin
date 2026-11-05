// 模式配置的持久化：用户自己的模式定义落在 `{dshHome}/modes/<id>.toml`，cordis 上的 `config.modes` 只是
// **默认模板**。读的时候用户文件覆盖同 id 的模板；写的时候只动用户文件，不碰 profile 的 patch。

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { parse, stringify } from "smol-toml";

function modesDir(): string {
  return dshHomePath("modes");
}

// 用户改过的模式：id → 覆盖模板的那份定义。坏文件按"没有"处理（模板继续生效）。
export async function loadModeOverrides(): Promise<Record<string, Record<string, unknown>>> {
  const dir = modesDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const name of entries) {
    if (!name.endsWith(".toml")) continue;
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    try {
      overrides[name.slice(0, -".toml".length)] = parse(text) as Record<string, unknown>;
    } catch {
      // 坏文件不阻断启动：同 id 继续用模板。
    }
  }
  return overrides;
}

// `smol-toml` 只出单行字符串：把含换行的值改写成 TOML 多行字符串，persona 这类才读得动。
function prettyToml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = /^(\s*[A-Za-z0-9_.-]+)\s*=\s*"((?:[^"\\]|\\.)*)"$/u.exec(line);
      if (match === null) return line;
      const [, key, raw] = match;
      if (key === undefined || raw === undefined || !raw.includes("\\n")) return line;
      const value = raw.replace(/\\n/gu, "\n").replace(/\\"/gu, '"').replace(/"""/gu, '\\"""');
      return `${key} = """\n${value}"""`;
    })
    .join("\n");
}

export async function writeMode(id: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(modesDir(), { recursive: true });
  await writeFile(join(modesDir(), `${id}.toml`), prettyToml(stringify(value)), "utf8");
}

export async function removeMode(id: string): Promise<void> {
  await rm(join(modesDir(), `${id}.toml`), { force: true });
}
