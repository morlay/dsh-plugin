/**
 * 探针：装配一次真实 web profile，检查**注入通道的装配平面**与模式差异的落点。
 *
 * 判据（2026-09-23）：通道是**全局一份**——装配层可见 `contextAssembler`，而没有任何 preset mount 里
 * 再发布一份。模式之间的差异由 `context-scope` 行表达（工具白名单 / instruction / 动态快照开关），
 * 不在通道上。
 *
 * 历史：2026-09-22 的判据相反（"root realm 读不到通道、只有我们把通道关在模式子树里"），那是为了挡住
 * 注入漏进官方 preset 的会话。官方四个 preset 被禁用之后（`preset-standard` / `ptc` / `minimal` /
 * `cordis` 行 disabled），这个前提不再成立；隔离反而把**跨包的消费者**挡在服务之外——
 * `@morlay/dsh-agent-toolkit` 的工具说明行住在别的包，`inject` 不到被关住的通道（行停在 waiting）。
 * 见 [ADR 通道作为全局服务装配不隔离](../../context/dsh-context-assembler/.agents/adrs/20260923-通道作为全局服务装配不隔离.md)。
 *
 * 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
 *
 * ```sh
 * pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-preset-isolation.mts
 * ```
 *
 * 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
 * `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改，也不建会话。
 */

import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayeredEnv, loadProfileDirectory } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

/** 我们自己的模式：只有它们该有注入通道。 */
const OWN_PRESETS: readonly string[] = ["coding", "chat"];

const PORT = 3098;
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
    `verify-preset-isolation: 没有可用的 web profile（${profileDir}）——先跑一次 ` +
      "`just custom dev --web` 或 `just custom desktop` 让 desktopify 准备好它",
  );
  process.exit(2);
}

const profileRequire = createRequire(join(profileDir, "package.json"));
const { livePresetMounts } = (await import(
  profileRequire.resolve("@deepseek-ai/dsh-agent-preset-registry")
)) as {
  livePresetMounts: () => {
    presetId: string;
    fiber: { parent: { fiber: unknown } };
  }[];
};

process.env.DSH_HOME = store;

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "web",
  resolvedProfile: { profile: loadProfileDirectory("dsh", profileDir, installAnchor), installAnchor },
  patchFiles: [],
  args: ["--no-open", "--port", String(PORT)],
});

const failures: string[] = [];

/** 这个 fiber 是不是 `root` 本身或挂在它的子树里（成员判定是对象身份）。 */
function withinFiber(fiber: unknown, root: unknown): boolean {
  let current = fiber as { parent: { fiber: unknown } };
  while (true) {
    if (current === root) return true;
    const parent = current.parent.fiber as { parent: { fiber: unknown } };
    if (parent === current) return false;
    current = parent;
  }
}

/** 一棵 preset 子树发布的服务名。 */
function servicesOf(mount: { fiber: unknown }): Set<string> {
  const store_ = (ctx as unknown as { reflect: { store: Record<symbol, { name: string; fiber: unknown }> } })
    .reflect.store;
  const names = new Set<string>();
  for (const key of Object.getOwnPropertySymbols(store_)) {
    const implementation = store_[key];
    if (implementation === undefined) continue;
    if (withinFiber(implementation.fiber, mount.fiber)) names.add(implementation.name);
  }
  return names;
}

const rootChannel = (ctx as unknown as { contextAssembler?: unknown }).contextAssembler;
console.log(
  `verify-preset-isolation: 装配层的 contextAssembler — ${rootChannel === undefined ? "不可见（通道没装上？）" : "可见（全局一份）"}`,
);
if (rootChannel === undefined) {
  failures.push(
    "contextAssembler is missing from the assembly plane; the channel row must publish one global instance",
  );
}

const mounts = livePresetMounts();
for (const mount of mounts) {
  const services = servicesOf(mount);
  const own = OWN_PRESETS.includes(mount.presetId);
  const hasChannel = services.has("contextAssembler");
  console.log(
    `verify-preset-isolation: preset ${mount.presetId} — ${own ? "自有" : "官方"}，通道 ${hasChannel ? "又一份（回归！）" : "无"}`,
  );
  if (hasChannel) {
    failures.push(
      `preset ${mount.presetId} publishes a second contextAssembler; the channel belongs to the assembly plane`,
    );
  }
}

for (const id of OWN_PRESETS) {
  if (!mounts.some((mount) => mount.presetId === id)) {
    failures.push(`our preset ${id} is not mounted at all`);
  }
}

// 动态快照（沙箱策略 / 审批策略）按模式给：chat 没有文件与 shell 工具，那两条对它全是噪音，
// 所以 `context-scope` 的 `runtimeContext: false` 在那个 scope 上调了 suppression。
// 判据必须成对：chat 空、coding 非空——否则"全局关掉"也能让 chat 的检查通过。
interface ScopeLease {
  readonly key: object;
  [Symbol.asyncDispose](): Promise<void>;
}
const registry = (ctx as unknown as {
  agentPresets: { acquireScope(id?: string): Promise<ScopeLease> };
}).agentPresets;
const runtimeContextNames = async (id: string): Promise<string[]> => {
  const lease = await registry.acquireScope(id);
  try {
    const assembly = (await (
      ctx as unknown as { systemPrompt: { assemble(context: { scope: object }): Promise<{ contexts: { name: string }[] }> } }
    ).systemPrompt.assemble({ scope: lease.key })) as { contexts: { name: string }[] };
    return assembly.contexts.map((entry) => entry.name).toSorted();
  } finally {
    await lease[Symbol.asyncDispose]();
  }
};

const chatContexts = await runtimeContextNames("chat");
console.log(
  `verify-preset-isolation: chat 的动态快照 — ${chatContexts.length === 0 ? "无（抑制生效）" : chatContexts.join(", ")}`,
);
if (chatContexts.length > 0) {
  failures.push(`chat assembly still carries runtime context: ${chatContexts.join(", ")}`);
}

const codingContexts = await runtimeContextNames("coding");
console.log(
  `verify-preset-isolation: coding 的动态快照 — ${codingContexts.length === 0 ? "无（被全局关掉了？）" : codingContexts.join(", ")}`,
);
if (codingContexts.length === 0) {
  failures.push("coding assembly lost every runtime context; the suppression must stay scoped to chat");
}

await shutdown.shutdown(failures.length === 0 ? 0 : 1);
for (const failure of failures) console.error(`verify-preset-isolation: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
