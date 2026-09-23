/**
 * 探针：装配一次真实 web profile，检查**装配面的四条事实**——这几条静态断言与包内测试都看不见。
 *
 * 判据（2026-09-24）：
 *
 * 1. `ctx.contextAssembler` 在装配层可见：注入通道全局一份（模式收口挂在它上面，工具说明在别的包里
 *    `inject` 它）；
 * 2. `ctx.sessionToolScope` 存在：模式收口那一行（`context-assembler-scope`）真的装上了；
 * 3. `ctx.agentPresets` **不存在**：官方 agent preset 那一套（registry 行）已被装配层禁用——它还在的话，
 *    模式就有了两套并行机制，且每 revision 会带一棵 Loader 子树；
 * 4. `ctx.sessionModes` 的清单等于 `session-mode` 行的 config（`coding` / `chat`，默认 `coding`）。
 *
 * 历史：2026-09-23 的判据是"通道全局一份、preset mount 里不得有第二份"，2026-09-22 的判据更相反
 * （通道必须关在模式子树里）。模式不再是 Cordis 子树之后，第二条与"mount"一起消失——见
 * [ADR 模式不再是 Cordis 子树](../../../profile/dsh-session-mode/.agents/adrs/20260924-模式不再是cordis子树.md)。
 *
 * 模式之间的**行为**差异（chat 没有动态快照、工具目录被收口）在包内真依赖装配里测
 * （`session-mode.spec.ts` 与 `context-assembler-scope.spec.ts`），这里只回答"装配面装上了什么"。
 *
 * 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
 *
 * ```sh
 * pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts
 * ```
 *
 * 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
 * `just custom dev --web` 或 `just custom desktop`）；脚本只读它，不会改，也不建会话。
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayeredEnv, loadProfileDirectory } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

const PORT = 3098;
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const store = join(repoRoot, "apps/dsh-custom-next/.dsh-store");
const profileDir = join(store, "profiles", "web");
const installAnchor = join(repoRoot, "vendor/deepseek-harness/apps/cli/package.json");

/** 部署里应当存在的那两个模式。 */
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

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "web",
  resolvedProfile: {
    profile: loadProfileDirectory("dsh", profileDir, installAnchor),
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
  sessionModes?: { roster(): { default: string; modes: readonly { id: string }[] } };
};

console.log(
  `verify-session-mode: contextAssembler — ${services.contextAssembler === undefined ? "不可见（通道没装上？）" : "可见（全局一份）"}`,
);
if (services.contextAssembler === undefined) {
  failures.push("contextAssembler is missing from the assembly plane");
}

console.log(
  `verify-session-mode: sessionToolScope — ${services.sessionToolScope === undefined ? "不可见（收口行没装上？）" : "可见"}`,
);
if (services.sessionToolScope === undefined) {
  failures.push(
    "sessionToolScope is missing; the context-assembler-scope row did not activate in this deployment",
  );
}

console.log(
  `verify-session-mode: agentPresets — ${services.agentPresets === undefined ? "不存在（官方那一套已禁用）" : "仍在（回归！）"}`,
);
if (services.agentPresets !== undefined) {
  failures.push(
    "the official agent preset registry is still mounted; modes must not have two parallel mechanisms",
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

// 页面用的是 HTTP 面（`GET /session-mode` 给清单、`POST` 切换）：路由没注册的话请求会落到静态资源
// fallback，client 半的 chip 永远读不到清单。这条与 `/session-editor` 那条判据同类。
const connection = (ctx as unknown as { connection?: { authenticatedUrl(base: string): string } })
  .connection;
const base =
  connection?.authenticatedUrl(`http://127.0.0.1:${String(PORT)}`) ??
  `http://127.0.0.1:${String(PORT)}`;
const withPath = (path: string): string => {
  const url = new URL(base);
  url.pathname = path;
  return url.toString();
};
const cookie = await fetch(withPath("/"), { redirect: "manual" })
  .then((response) => response.headers.get("set-cookie"))
  .catch(() => null);
const cookieHeader: Record<string, string> =
  cookie === null || cookie === undefined ? {} : { cookie: cookie.split(";")[0]! };
const rosterResponse = await fetch(withPath("/session-mode"), {
  method: "GET",
  headers: { accept: "application/json", ...cookieHeader },
});
const served = (await rosterResponse.json().catch(() => undefined)) as
  | { default?: string; modes?: readonly { id?: string }[] }
  | undefined;
const servedIds = (served?.modes ?? []).map((mode) => mode.id);
console.log(
  `verify-session-mode: GET /session-mode — ${String(rosterResponse.status)} default=${served?.default ?? "(缺失)"} modes=${servedIds.join(", ") || "(缺失)"}`,
);
if (rosterResponse.status !== 200) {
  failures.push(
    `GET /session-mode did not reach the session-mode route (status ${String(rosterResponse.status)})`,
  );
} else if (served?.default !== EXPECTED_DEFAULT) {
  failures.push(
    `GET /session-mode served default=${String(served?.default)}, expected ${EXPECTED_DEFAULT}`,
  );
}

// `POST` 那条路要读会话与 agent 注册表：cordis 的**属性访问**要求本 fiber 在 `inject` 里点过名，漏一个就抛
// `cannot get property "…" without inject`（只跑 GET 看不见——2026-09-24 的真回归）。这里用一个不存在的会话
// 打一次：期望 409 加我们自己那句「未知的会话」，而不是任何 inject 报错。
const selectResponse = await fetch(withPath("/session-mode"), {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json", ...cookieHeader },
  body: JSON.stringify({ sessionId: "no-such-session", mode: EXPECTED_MODES[1] }),
});
const selectBody = (await selectResponse.json().catch(() => undefined)) as
  | { error?: unknown }
  | undefined;
const refusal = typeof selectBody?.error === "string" ? selectBody.error : "";
console.log(
  `verify-session-mode: POST /session-mode（未知会话）— ${String(selectResponse.status)} ${refusal.slice(0, 80)}`,
);
if (selectResponse.status !== 409 || !refusal.includes("未知的会话")) {
  failures.push(
    `POST /session-mode did not answer with our own refusal (status ${String(selectResponse.status)}, body ${refusal.slice(0, 120)}); ` +
      "an inject error means the session-mode fiber does not declare the registry it reads",
  );
}

// 抽读几个已存在的会话（只读）：`read` 会跑上游的持久化校验，而我们自造的事件类型（`session-mode/selected`）
// 必须先带上 `ignorable` 信封，否则整个会话打不开。抽读历史数据顺带验证读路径的兜底——补信封之前写下的会话
// 靠 adopt 分支补回来（真回归：切换模式后会话读不出来）。
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
