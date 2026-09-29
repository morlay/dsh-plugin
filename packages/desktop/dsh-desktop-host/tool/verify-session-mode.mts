// 探针：装配一次真实 web profile，检查**装配面的四条事实**——这几条静态断言与包内测试都看不见。
//
// 判据：
//
// 1. `ctx.contextAssembler` 在装配层可见：注入通道全局一份（工具说明在别的包里 `inject` 它，模式收口把
// `instructions` 开关拨给它）；
// 2. `ctx.sessionToolScope` **不存在**：收口由 `session-mode` 行内部持有——它不再是服务，也没有自己的行；
// 3. `ctx.agentPresets` **存在**：registry 是行清单与选择面的 home；本部署不声明自己的 preset，
// registry 的默认是官方 shipped `standard`；
// 4. `ctx.sessionModes` **存在**，清单等于 `session-mode` 行的 config（`coding` / `chat`，默认 `coding`），且
// `modeForPreset` 只在**唯一映射**时回答——本部署两个模式都不声明 `preset`，任何 preset 都返回 `undefined`
// （不反查；模式由会话事实决定）。
//
// 模式之间的**行为**差异（chat 没有动态快照、工具目录被收口、官方两条注入面被丢）在包内真依赖装配里测
// （`session-mode.spec.ts`、`scope.spec.ts` 与 `preset-plane.spec.ts`），这里只回答"装配面装上了什么"。
//
// 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
//
// ```sh
// pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts
// ```
//
// 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
// `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改，也不建会话。

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLayeredEnv,
  loadProfileDirectory,
  reportSkippedBundles,
} from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

const PORT = 3098;
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const store = join(repoRoot, "apps/dsh-custom-next/.dsh-store");
const profileDir = join(store, "profiles", "web");
const installAnchor = join(repoRoot, "vendor/deepseek-harness/apps/cli/package.json");

// 部署里应当存在的那两个模式。
const EXPECTED_MODES: readonly string[] = ["coding", "chat"];
const EXPECTED_DEFAULT = "coding";

const profileReady = await access(join(profileDir, "package.json")).then(
  () => true,
  () => false,
);
if (!profileReady) {
  console.error(
    `verify-session-mode: 没有可用的 web profile（${profileDir}）——先跑一次 ` +
      "`just custom dev --web` 或 `just custom desktop` 让 desktopify 准备好它",
  );
  process.exit(2);
}

process.env.DSH_HOME = store;

// 加载跳过原因由启动方上报。
const profile = loadProfileDirectory("dsh", profileDir, installAnchor);
reportSkippedBundles("dsh", profile);

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "web",
  resolvedProfile: {
    profile,
    installAnchor,
  },
  patchFiles: [],
  args: ["--no-open", "--port", String(PORT)],
});

const failures: string[] = [];

const services = ctx as unknown as {
  contextAssembler?: unknown;
  sessionToolScope?: unknown;
  agentPresets?: unknown;
  sessionModes?: {
    roster(): { default: string; modes: readonly { id: string }[] };
    modeForPreset(preset: string | undefined): string | undefined;
  };
};

console.log(
  `verify-session-mode: contextAssembler — ${services.contextAssembler === undefined ? "不可见（通道没装上？）" : "可见（全局一份）"}`,
);
if (services.contextAssembler === undefined) {
  failures.push("contextAssembler is missing from the assembly plane");
}

// 收口在 `session-mode` 行**内部**（工具名单与三个开关）：它不该再作为服务出现在装配面上——出现就说明有人把
// 那一行又装回来了（收口会因此变成两份真源）。
console.log(
  `verify-session-mode: sessionToolScope — ${services.sessionToolScope === undefined ? "不存在（收口由 session-mode 内部承担）" : "可见（收口又变成服务了？）"}`,
);
if (services.sessionToolScope !== undefined) {
  failures.push(
    "sessionToolScope should not exist; the per-session scope lives inside the session-mode row",
  );
}

console.log(
  `verify-session-mode: agentPresets — ${services.agentPresets === undefined ? "不存在（官方 registry 没装上？）" : "可见（行清单与选择面归它）"}`,
);
if (services.agentPresets === undefined) {
  failures.push(
    "the official agent preset registry is missing; presets own the agent row list and the session-level picker",
  );
}

const roster = services.sessionModes?.roster();
const ids = (roster?.modes ?? []).map((mode) => mode.id);
console.log(
  `verify-session-mode: 模式清单 — default=${roster?.default ?? "(缺失)"} modes=${ids.join(", ") || "(缺失)"}`,
);
if (roster === undefined) {
  failures.push("ctx.sessionModes is missing; the session-mode row did not load");
} else {
  if (roster.default !== EXPECTED_DEFAULT) {
    failures.push(`session-mode default is ${roster.default}, expected ${EXPECTED_DEFAULT}`);
  }
  const missing = EXPECTED_MODES.filter((id) => !ids.includes(id));
  if (missing.length > 0) failures.push(`session-mode roster is missing: ${missing.join(", ")}`);
}

// 反查（preset → 模式）只在**唯一映射**时回答：本部署两个模式都不声明 `preset`，所以**任何** preset 都不该
// 反查出模式——抽两条官方 shipped preset 覆盖这条判据（两条都复用同一条失败文案）。
const SAMPLE_PRESETS: readonly string[] = ["standard", "minimal"];
for (const preset of SAMPLE_PRESETS) {
  const mode = services.sessionModes?.modeForPreset(preset);
  console.log(`verify-session-mode: preset→模式 — ${preset} → ${mode ?? "(不反查)"}`);
  if (mode !== undefined) {
    failures.push(
      `modeForPreset(${JSON.stringify(preset)}) should be undefined (no mode binds a preset here), got ${String(mode)}`,
    );
  }
}

// 抽读几个已存在的会话（只读）：顺带验证读路径对我们自造事件类型（`session-mode/selected`，带
// `ignorable` 信封）的兜底。
const persistence = (
  ctx as unknown as {
    sessionPersistence?: {
      list(): Promise<readonly { header: { readonly id: string } }[]>;
      open(
        id: string,
        access: "read",
      ): Promise<{ read(): Promise<unknown>; close(): Promise<void> }>;
    };
  }
).sessionPersistence;
if (persistence === undefined) {
  failures.push("sessionPersistence is missing; cannot check that stored sessions stay readable");
} else {
  const stored = await persistence.list();
  const sample = stored.slice(0, 5);
  const unreadable: string[] = [];
  for (const snapshot of sample) {
    const handle = await persistence.open(snapshot.header.id, "read");
    try {
      await handle.read();
    } catch (error: unknown) {
      unreadable.push(
        `${snapshot.header.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await handle.close();
    }
  }
  console.log(
    `verify-session-mode: 会话读取 — 抽读 ${String(sample.length)}/${String(stored.length)}${unreadable.length === 0 ? "，都可读" : "，有打不开的"}`,
  );
  for (const failure of unreadable) failures.push(`stored session is unreadable — ${failure}`);
}

await shutdown.shutdown(failures.length === 0 ? 0 : 1);
for (const failure of failures) console.error(`verify-session-mode: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
