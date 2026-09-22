/**
 * 探针：装配一次真实 web profile，检查**每个 preset 的 isolate realm 里有没有我们的注入通道**。
 *
 * 为什么需要它：`ctx.contextAssembler` 曾经住 host 层（「部署级一份、一行覆盖全部 preset」），
 * 于是我们 preset 里那些注入行的注册漏进了官方 standard / ptc / minimal / cordis 的会话——工作区
 * 指令、skill 目录、工具用法分组、引用材料全都照注入，静态断言与单测都看不见（它们只看行清单）。
 * 改成每个模式自带一份、关进 `isolate` 组以后，判据变成"只有我们自己的 preset 有这份服务"。
 *
 * 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
 *
 * ```sh
 * just profile
 * ```
 *
 * 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
 * `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改，也不建会话。
 *
 * 判据：root realm 里读不到 `contextAssembler`；每个 preset mount 的子树里，只有我们自己的模式
 * （`OWN_PRESETS`）有它。
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
  `verify-preset-isolation: root realm 的 contextAssembler — ${rootChannel === undefined ? "不可见" : "可见（泄漏！）"}`,
);
if (rootChannel !== undefined) {
  failures.push("contextAssembler is visible in the root realm; it must live inside the preset isolate realm");
}

const mounts = livePresetMounts();
for (const mount of mounts) {
  const services = servicesOf(mount);
  const own = OWN_PRESETS.includes(mount.presetId);
  const hasChannel = services.has("contextAssembler");
  console.log(
    `verify-preset-isolation: preset ${mount.presetId} — ${own ? "自有" : "官方"}，通道 ${hasChannel ? "有" : "无"}`,
  );
  if (own && !hasChannel) {
    failures.push(`preset ${mount.presetId} has no contextAssembler in its own isolate realm`);
  }
  if (!own && hasChannel) {
    failures.push(
      `preset ${mount.presetId} publishes contextAssembler; our injection rows must not reach official presets`,
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
