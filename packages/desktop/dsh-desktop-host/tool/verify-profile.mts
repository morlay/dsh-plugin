/**
 * 探针：装配一次真实 web profile，检查几条**只有真装配才能看见**的运行期事实。
 *
 * 为什么需要它（两条真实回归，都是静态断言与单测抓不到的）：
 *
 * 1. **preset roster 的装载结果**：`dsh-preset` 的 patch 里有若干按 id 禁用 host 行的装配，那是全局
 *    动作——官方 standard / ptc / cordis 的 preset 行也吃这一刀。2026-09-22 禁用
 *    `subagent-model-selection-settings` 就把那三个官方 preset 打成了 `broken`
 *    （`requires ... in the Host scope`）。
 * 2. **`session/list` 是否带出会话标题**：标题走投影缓存（`projections.values.title`）——2026-09-22 就是
 *    这里漏跟了上游契约（0.1.7 把 `cachedSnapshot` / `cachedPredecessorTitle` 的 `inheritedEventCount`
 *    参数去掉了，我们还按旧签名匹配），结果列表里所有投影值（title / blank / tokenUsage）全空。
 * 3. **`/session-editor` 路由是否真的注册上了**：`SessionEditor` 构造时 `webServer` 可能还没激活，
 *    而一次性 `ctx.get` 不会重试 → 路由缺失 → 请求落到 `frontend-static` 的 fallback，非 GET/HEAD
 *    一律 405（编辑撤回 / 重试的症状）。单测用假装配直接 provide `webServer`，所以永远注册成功，
 *    掩盖了这个顺序问题。
 *
 * 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
 *
 * ```sh
 * just profile
 * ```
 *
 * 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
 * `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改。端口用 3099，避免撞上
 * 正在运行的实例（默认 3080）。
 *
 * 判据：每个 preset 都没有 `broken`，且 `POST /session-editor` 命中我们自己的 handler
 * （用一个非法 body，期望拿到我们自己的 400 文案；405/404 都说明路由没注册）。
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

const PORT = 3099;
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
    `verify-profile: 没有可用的 web profile（${profileDir}）——先跑一次 ` +
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
  args: ["--no-open", "--port", String(PORT)],
});

const failures: string[] = [];

const registry = (ctx as unknown as { agentPresets?: { list(): Promise<PresetRow[]> } }).agentPresets;
const rows = (await registry?.list()) ?? [];
for (const row of rows) {
  const state = row.broken === undefined ? "ok" : `broken: ${row.broken}`;
  console.log(`verify-profile: preset ${row.id} — ${state}`);
  if (row.broken !== undefined) failures.push(`preset ${row.id} is broken: ${row.broken}`);
}

const controller = (
  ctx as unknown as {
    sessionController?: {
      list(req: unknown, signal: AbortSignal): Promise<{ items: { projections?: { values?: { title?: string } } }[] }>;
    };
  }
).sessionController;
const list = await controller?.list({}, new AbortController().signal);
const titled = (list?.items ?? []).filter((item) => item.projections?.values?.title !== undefined);
console.log(
  `verify-profile: session/list — items=${String(list?.items.length ?? 0)} withTitle=${String(titled.length)}`,
);
if ((list?.items.length ?? 0) > 0 && titled.length === 0) {
  failures.push(
    "session/list returned no title projection for any row; the projection-cache read contract is probably stale",
  );
}

const connection = (ctx as unknown as { connection?: { authenticatedUrl(base: string): string } })
  .connection;
const base = connection?.authenticatedUrl(`http://127.0.0.1:${String(PORT)}`) ?? `http://127.0.0.1:${String(PORT)}`;
const response = await fetch(new URL("/session-editor", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ operation: "not-a-real-op", sessionId: "x" }),
});
const body = await response.text();
console.log(`verify-profile: POST /session-editor — ${String(response.status)} ${body.slice(0, 80)}`);
if (response.status !== 400 || !body.includes("action")) {
  failures.push(
    `POST /session-editor did not reach the session-editor handler (status ${String(response.status)}); ` +
      "405/404 means the route never registered (webServer activated after the editor)",
  );
}

await shutdown.shutdown(failures.length === 0 ? 0 : 1);
for (const failure of failures) console.error(`verify-profile: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
