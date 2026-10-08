// 文档里的引用必须落得到真文件：行内代码里的工作区路径、`just <recipe>`、探针路径（`tool/*.mts`）。
// 与 markdown-links.spec.ts 分工：那条守**链接目标**（`[x](path)`），这条守**行内代码里的路径**；
// 行内代码只当链接文本用短形式时，可解析的路径在链接目标里，那条已经在守，这里不重复判。
// 规则、判据与例外表见 `.agents/standards/describing-facts.md`（这份 spec 就是它的判据）。
import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
// 上游源码：文档引用上游文件时写的是上游仓内的相对路径（`packages/core/system-prompt/src/index.ts`）。
const UPSTREAM = join(ROOT, "vendor/deepseek-harness");
const SKIP_DIRS = new Set([
  ".dsh-desktopify",
  ".git",
  ".pnpm",
  ".scratch",
  ".tmp",
  "build",
  "dist",
  "lib",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

// 以已知扩展名结尾才算路径；占位与语法形态（`<…>`、`…`、`*`、`{}`、markdown 括号、shell 变量）排除。
const SOURCE_EXT =
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|json5|md|yml|yaml|css|svg|sql|toml|sh|txt|patch)$/u;
const NOT_A_PATH = /[\s`*<>…{}|$="'?!()[\]]/u;
// 历史修订路径（`git show HEAD:<path>`）：那个路径指的不是工作区当前状态。
const REVISION = /^(?:[0-9a-f]{7,40}|HEAD|MERGE_HEAD|ORIG_HEAD)(?:[~^]\d*)?:/iu;
// 构建产物 / 打包器布局 / 运行期数据：不是工作区里的源文件（本地不构建就压根没有）。
const NON_SOURCE_DIR = /^(?:dist|lib|build|out|target|deploy|pnpm|userData|\.dsh-desktopify)\//u;
const LINE_SUFFIX = /:\d+(?:-\d+)?$/u;
const REMOTE = /^(?:https?:|mailto:)/u;

// 解析基址（按序取第一个存在的）：文档所在目录 → 所在包根 → 包内 `src/` → 所在 scope 目录 →
// 仓库根 → `packages|devpackages|apps/`（跨包省略前缀）→ 上游仓根及其 `packages|vendor|apps/`。
// 上游短形式（`fs/src/types.ts`）与探针（`tool/x.mts`）靠最后一步的**工作区唯一后缀匹配**兜。
const basesOf = (dir: string, packageRoot: string): string[] => [
  dir,
  packageRoot,
  join(packageRoot, "src"),
  dirname(packageRoot),
  ROOT,
  join(ROOT, "packages"),
  join(ROOT, "devpackages"),
  join(ROOT, "apps"),
  UPSTREAM,
  join(UPSTREAM, "packages"),
  join(UPSTREAM, "vendor"),
  join(UPSTREAM, "apps"),
];

// 例外表：机械解析不到、但按上下文合理的引用。理由不是「它存在」，
// 而是「为什么这条引用不该由这条检查判」。判据与取舍写在 `.agents/standards/describing-facts.md`。
// 匹配是「文件 + 代码原文」精确匹配：引用一改（哪怕只改行号）就回到检查范围，这是有意的。
const SAMPLE = "示例 / 通式：说的是通例（每个包都该有、按约定探测入口），没有唯一所指";
const SHORT_FORM = "省略前缀的短形式：省了包名或 `.agents/`，或承接同句前一个全路径";
const ELSEWHERE = "「同包 / 该包」指文内已交代的另一个包（上游包或兄弟包），代码片段省了前缀";
const EXCEPTIONS: readonly {
  readonly file: string;
  readonly code: string;
  readonly reason: string;
}[] = [
  // 通式 / 示例
  {
    file: ".agents/adrs/20260917-workspace跨vendor链接与devkit工具链复用.md",
    code: "src/index.ts",
    reason: SAMPLE,
  },
  {
    file: ".agents/adrs/20260917-workspace跨vendor链接与devkit工具链复用.md",
    code: "src/client/index.ts",
    reason: SAMPLE,
  },
  { file: ".agents/standards/how-to-write.md", code: "src/client/index.ts", reason: SAMPLE },
  { file: ".agents/standards/how-to-write.md", code: "locale/en.json", reason: SAMPLE },
  { file: ".agents/standards/how-to-write.md", code: "locale/zh.json", reason: SAMPLE },
  { file: ".agents/standards/how-to-write.md", code: "./cordis.patch.yml", reason: SAMPLE },
  { file: ".agents/standards/how-to-write.md", code: "./icon.svg", reason: SAMPLE },
  {
    file: "packages/desktop/dsh-desktopify/.agents/standards/how-to-verify.md",
    code: "src/client/index.ts",
    reason: SAMPLE,
  },
  // 短形式
  {
    file: ".agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md",
    code: "src/index.ts:318-334",
    reason: `${SHORT_FORM}（=\`packages/preset/agent-preset-registry/src/index.ts\`）`,
  },
  {
    file: ".agents/skills/dsh-plugin-implement/SKILL.md",
    code: "standards/how-to-verify.md",
    reason: SHORT_FORM,
  },
  {
    file: ".agents/standards/how-to-write.md",
    code: "src/__tests__/upstream-wiring.spec.ts",
    reason: `${SHORT_FORM}（= subagent 包内）`,
  },
  {
    file: "packages/session/session-branch/.agents/adrs/20260920-删除版本树投影并停止写版本效果.md",
    code: "session-branch/types.ts",
    reason: `${SHORT_FORM}（带了包名前缀：= \`packages/session/session-branch/src/types.ts\`）`,
  },
  // 文内已交代的另一个包
  {
    file: "packages/desktop/dsh-desktop-host/.agents/adrs/20260928-桌面档不含登录与账号面.md",
    code: "src/protocol.ts:241-252",
    reason: `${ELSEWHERE}（= 上游 credentials/deepseek-account-platform）`,
  },
  {
    file: "packages/desktop/dsh-desktop-shell/.agents/debts/20260928-桌面壳自己实现上游的原生快捷键桥.md",
    code: "src/client/index.ts:44-46",
    reason: `${ELSEWHERE}（= 上游 client/shortcuts）`,
  },
  {
    file: "packages/desktop/dsh-desktopify/.agents/debts/20260920-桌面宿主覆写connection认证方法.md",
    code: "src/index.ts",
    reason: `${ELSEWHERE}（= packages/desktop/dsh-desktop-host）`,
  },
  {
    file: "packages/desktop/dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md",
    code: "src/index.ts",
    reason: `${ELSEWHERE}（= packages/desktop/dsh-desktop-host，同段全路径已给）`,
  },
  {
    file: "packages/desktop/dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md",
    code: "src/seed.ts",
    reason: `${ELSEWHERE}（= packages/desktop/dsh-desktop-shell）`,
  },
  {
    file: "packages/session/session-rdb/.agents/adrs/20260929-管理面HTTP路由前缀与上游分家.md",
    code: "client/controller.ts",
    reason: `${ELSEWHERE}（= ui-conversation-manager 的 client 半）`,
  },
  {
    file: "packages/session/ui-conversation-message-actions/.agents/adrs/20260917-接管官方ui-conversation行（薄壳fork）.md",
    code: "client/apply.ts",
    reason: `${ELSEWHERE}（= 当时那个薄壳 fork 包的 client 装配，该包已删）`,
  },
  {
    file: "packages/subagent/dsh-subagent/.agents/designs/20260929-薄壳fork的接管面与保留文件.md",
    code: "./child-agent.ts",
    reason: `${ELSEWHERE}（= 上游 subagent 包内同目录的那个文件）`,
  },
  // 上游短形式
];

// 行内代码片段（成对的单反引号）与它所在行号；fenced code block 内的不算行内代码。
function spansOf(
  markdown: string,
): { readonly line: number; readonly text: string; readonly at: number }[] {
  const spans: { line: number; text: string; at: number }[] = [];
  let fenced = false;
  for (const [index, line] of markdown.split("\n").entries()) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    // 行内代码是链接文本（`[`短`](path)`）时跳过：那条链接由 markdown-links 守。
    const linkText = [...line.matchAll(/\[[^\]\n]*\]\([^)\s]*\)/gu)].map(
      (match) => [match.index + 1, match.index + match[0].indexOf("]")] as const,
    );
    for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
      const at = match.index;
      if (linkText.some(([start, end]) => at >= start && at < end)) continue;
      spans.push({ line: index + 1, text: match[1] ?? "", at });
    }
  }
  return spans;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function markdownFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await markdownFiles(join(dir, entry.name), found);
      continue;
    }
    if (entry.name.endsWith(".md")) found.push(join(dir, entry.name));
  }
  return found;
}

// 最近的含 package.json 的祖先目录 = 该 md 所属包根（`src/scope.ts` 这类引用相对它解析）。
async function packageRootOf(dir: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  let cursor = dir;
  for (;;) {
    if (await exists(join(cursor, "package.json"))) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  cache.set(dir, cursor);
  return cursor;
}

// 后缀索引：只为「基址都解析不到」的引用建立，按 basename 收敛（常态零开销）。
async function suffixIndex(names: ReadonlySet<string>): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), prefix);
        continue;
      }
      if (!names.has(entry.name)) continue;
      const path = prefix + relative(ROOT, join(dir, entry.name));
      index.set(entry.name, [...(index.get(entry.name) ?? []), path]);
    }
  };
  await walk(ROOT, "");
  if (await exists(UPSTREAM)) await walk(UPSTREAM, `${relative(ROOT, UPSTREAM)}/`);
  return index;
}

// `just <recipe>`：第一段是根 justfile 的 recipe 或 `mod` 名；是 mod 时第二段查该模块的 justfile。
function recipesOf(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/^([a-zA-Z][\w-]*)(?:\s[^:\n]*)?:(?!=)/gmu)].map((match) => match[1] ?? ""),
  );
}

function modulesOf(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/^mod\s+([\w-]+)\s+['"]([^'"]+)['"]/gmu)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

describe("文档里的引用", () => {
  it("行内代码里的工作区路径都指向真实文件", async () => {
    const exceptions = new Set(EXCEPTIONS.map((entry) => `${entry.file}::${entry.code}`));
    const roots = new Map<string, string>();
    const pending: { file: string; line: number; code: string; bare: string }[] = [];
    let checked = 0;
    for (const file of await markdownFiles(ROOT)) {
      const relativeFile = relative(ROOT, file);
      for (const { line, text } of spansOf(await readFile(file, "utf8"))) {
        const code = text.trim();
        if (!code.includes("/") || NOT_A_PATH.test(code) || REMOTE.test(code)) continue;
        if (code.startsWith("@") || code.includes("...") || REVISION.test(code)) continue;
        const bare = code.replace(LINE_SUFFIX, "");
        if (!SOURCE_EXT.test(bare) || NON_SOURCE_DIR.test(bare)) continue;
        if (exceptions.has(`${relativeFile}::${code}`)) continue;
        checked += 1;
        const bases = basesOf(dirname(file), await packageRootOf(dirname(file), roots));
        let found = false;
        for (const base of bases) {
          if (await exists(resolve(base, bare))) {
            found = true;
            break;
          }
        }
        if (!found) pending.push({ file: relativeFile, line, code, bare });
      }
    }
    const index = await suffixIndex(new Set(pending.map((entry) => basename(entry.bare))));
    // 防空转：规则写窄了（正则写错、目录被跳过）会静默变绿，这里要求确实扫到了东西。
    expect(checked).toBeGreaterThan(100);
    const broken = pending.filter(({ bare }) => {
      const hits = (index.get(basename(bare)) ?? []).filter(
        (path) => path === bare || path.endsWith(`/${bare}`),
      );
      return hits.length !== 1;
    });
    expect(
      broken
        .map(
          ({ file, line, code }) =>
            `${file}:${line} \`${code}\` —— 解析不到文件：写全路径或补进例外表（见 describing-facts.md）`,
        )
        .sort(),
    ).toEqual([]);
  });

  it("`just <recipe>` 都在根 justfile 里", async () => {
    const rootJustfile = await readFile(join(ROOT, "justfile"), "utf8");
    const recipes = recipesOf(rootJustfile);
    const modules = modulesOf(rootJustfile);
    const broken: string[] = [];
    const seen = new Set<string>();
    for (const file of await markdownFiles(ROOT)) {
      const relativeFile = relative(ROOT, file);
      for (const { line, text } of spansOf(await readFile(file, "utf8"))) {
        for (const match of text.matchAll(/(?:^|[\s(（])just\s+([^\s`]+)(?:\s+([^\s`]+))?/gu)) {
          const head = match[1] ?? "";
          // 占位（`just <recipe>`、`just …`）与 `--list` 这类旗标不是 recipe 名。
          if (head.startsWith("-") || NOT_A_PATH.test(head)) continue;
          seen.add(head);
          if (recipes.has(head)) continue;
          const module = modules.get(head);
          if (module === undefined) {
            broken.push(
              `${relativeFile}:${line} just ${head} —— 根 justfile 里没有这条 recipe，也没有这个 mod`,
            );
            continue;
          }
          const sub = match[2] ?? "";
          if (sub.length === 0 || sub.startsWith("-") || NOT_A_PATH.test(sub)) continue;
          const subRecipes = recipesOf(await readFile(join(ROOT, module), "utf8"));
          if (!subRecipes.has(sub))
            broken.push(`${relativeFile}:${line} just ${head} ${sub} —— ${module} 里没有它`);
        }
      }
    }
    // 防空转：正则写错就静默变绿，这里要求确实扫到了 `just <recipe>`。
    expect(seen.size).toBeGreaterThan(0);
    expect(broken.sort()).toEqual([]);
  });
});
