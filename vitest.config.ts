import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// 测试分两层，**环境由文件名声明**（不写 `// @vitest-environment` 文件头，也不靠目录 / 裸 `.tsx` 推断）：
//   `*.spec.dom.ts` / `*.spec.dom.tsx` → `ui` 层（`happy-dom`）；
//   `*.spec.ts` → `node` 层。
//
// 渲 React 组件的测试用 `.spec.dom.tsx`，只碰 DOM（`document.querySelector`、断言注入的 `<style>`）的用
// `.spec.dom.ts`——两者都在 ui 层，扩展名只表达「它渲不渲组件」。
//
// 两层不重叠：`.dom` 夹在 `.spec` 与 `.ts` 之间，`*.spec.ts` 匹配不到 `*.spec.dom.ts`，所以不需要靠
// `exclude` 拆。
//
// **不要在 project 里设 `maxWorkers`**：那是**每层各自**的上限，两个 project 各设 100% 会变成「16 worker 抢
// 8 核」（实测全量 204s），设 50% 则把每层砍到半核（168s）。worker 数交给 vitest 按机器核数统一分配
// （默认 72.7s）；要更快用**全局**上限 `vitest run --maxWorkers=100%`（实测 53.5s，与分层前单层 51s 持平）。
//
// `.tmp/**` 也在排除里：测试的临时目录就落在 `.tmp/`（见下），那里会出现 `*.spec.ts` 的副本
// （federation / bundle 这类用例会复制一整个包树），不能被当成测试收进来。
const EXCLUDE = ["**/node_modules/**", "target/**", ".scratch/**", ".tmp/**"];

// 用例的临时目录落在**项目本地**的 `.tmp/<层>/`，而不是机器共享的 tmp 根。
//
// `os.tmpdir()` 读的就是 `TMPDIR`：worker 里改这个变量，**所有** `mkdtemp(join(tmpdir(), …))` 都跟着走，
// 不只是某一条路径。为什么必须换：机器 tmp 根是跨进程共享的，各种工具的产物堆在里面（本机实测 58.8 万条），
// 一次 `readdir(os.tmpdir())` 要 760ms；而每个用例至少一次 `mkdtemp`，上游 spill 的启动清扫还要把 tmp 根
// 整列一遍并把结果 `await` 到 dispose——慢的不是用例，是这层目录列举。换到本地之后：`dsh-agent-loop` +
// `dsh-agent-team` 从 35.8s 降到 13.3s，全量热跑 62.3s → 56.8s。
//
// **按层再分一级**（`.tmp/node` / `.tmp/ui`）：两层是并行跑的，混在一层里既难看条目数，也没法说「哪一层
// 留下了多少残留」。目录名与 project 名同源（`LAYERS`），不写两份。
//
// 落在仓库里是**有意的**：`.tmp/` 已在 `.gitignore` 里（可随时整删），并且被上面的 `EXCLUDE` 挡住不被
// include 收进测试。它与 `.scratch/` 不是一回事：`.scratch/` 放人工的交接 / 票据 / 探针（要能留），
// `.tmp/` 只放测试运行期产物（可随时删、不需要留）。
//
// **卸载顺序（踩过）**：fixture 的清理跑在 `onTestFinished` **之前**。用了 `appEnv` 临时目录的装配，
// 卸载必须登记到 `appEnv.onCleanup(...)`（`packages/zephyr/zephyr-app/src/testing/fixtures.ts` 的清理链），
// 否则会在目录被删之后又写回 `sessions/…`，`.tmp/<层>/` 每轮留残骸。
//
// 目录在配置加载时建（早于任何 worker），不用 globalSetup。
const TEST_TMPDIR = join(import.meta.dirname, ".tmp");

/** 两层各自的文件形状；`name` 同时是 project 名与 `.tmp/` 下的子目录名。 */
const LAYERS = [
  { name: "node", environment: "node", include: ["**/__tests__/**/*.spec.ts"] },
  {
    name: "ui",
    environment: "happy-dom",
    include: ["**/__tests__/**/*.spec.dom.ts", "**/__tests__/**/*.spec.dom.tsx"],
  },
] as const;

/** 一层的临时目录：`.tmp/<project 名>`。 */
function tmpdirOf(name: string): string {
  return join(TEST_TMPDIR, name);
}

export default defineConfig(async () => {
  await Promise.all(LAYERS.map(async (layer) => await mkdir(tmpdirOf(layer.name), { recursive: true })));
  return {
    oxc: { decorator: { legacy: true } },
    test: {
      projects: LAYERS.map((layer) => ({
        test: {
          name: layer.name,
          // worker 里的 `os.tmpdir()` 指向本层目录：夹具的 `mkdtemp`、上游 spill 的启动清扫都跟着走。
          env: { TMPDIR: tmpdirOf(layer.name), TMP: tmpdirOf(layer.name), TEMP: tmpdirOf(layer.name) },
          environment: layer.environment,
          include: [...layer.include],
          exclude: [...EXCLUDE],
          testTimeout: 3000,
          isolate: true,
        },
      })),
    },
  };
});