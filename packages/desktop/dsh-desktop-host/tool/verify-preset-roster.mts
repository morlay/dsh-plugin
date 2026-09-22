/**
 * 探针：装配一次真实 web profile，读 agent preset roster，报告每个 preset 是否装载成功。
 *
 * 为什么需要它：`dsh-preset` 的 patch 里有若干**按 id 禁用 host 行**的装配（为我们的接管让路）。
 * 那些禁用是全局的——官方 standard / ptc / cordis 的 preset 行也会被它们影响，而静态断言（行 id、
 * config 逐项比对）看不见装载结果。本脚本起一次真装配，registry 的 diagnostic 会把「等待缺失服务」
 * 之类的 preset 报成 `broken`（2026-09-22 就是这样抓到：禁用 `subagent-model-selection-settings`
 * 把三个官方 preset 打成了 broken）。
 *
 * 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
 *
 * ```sh
 * just roster
 * ```
 *
 * 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
 * `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改。端口用 3099，避免撞上
 * 正在运行的实例（默认 3080）。
 *
 * 判据：每个 preset 都没有 `broken` 字段即通过；有则脚本以非零码退出并打印原因。
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayeredEnv, loadProfileDirectory } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

interface PresetRow {
  readonly id: string;
  readonly broken?: string;
}

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const store = join(repoRoot, "apps/dsh-custom-next/.dsh-store");
const profileDir = join(store, "profiles", "web");
const installAnchor = join(repoRoot, "vendor/deepseek-harness/apps/cli/package.json");

const profileReady = await access(join(profileDir, "package.json")).then(
  () => true,
  () => false,
);
if (!profileReady) {
  console.error(
    `verify-preset-roster: 没有可用的 web profile（${profileDir}）——先跑一次 ` +
      "`just custom dev --web` 或 `just custom desktop` 让 desktopify 准备好它",
  );
  process.exit(2);
}

process.env.DSH_HOME = store;

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "web",
  resolvedProfile: { profile: loadProfileDirectory("dsh", profileDir, installAnchor), installAnchor },
  patchFiles: [],
  args: ["--no-open", "--port", "3099"],
});

const registry = (ctx as unknown as { agentPresets?: { list(): Promise<PresetRow[]> } }).agentPresets;
const rows = (await registry?.list()) ?? [];
const broken = rows.filter((row) => row.broken !== undefined);

for (const row of rows) {
  const state = row.broken === undefined ? "ok" : `broken: ${row.broken}`;
  console.log(`verify-preset-roster: ${row.id} — ${state}`);
}

await shutdown.shutdown(broken.length === 0 ? 0 : 1);
process.exit(broken.length === 0 ? 0 : 1);
