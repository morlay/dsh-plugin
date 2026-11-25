import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// 测试按**文件名**声明两个维度（不写 `// @vitest-environment` 文件头，也不靠目录 / 裸 `.tsx` 推断）：
//
//   `.spec.ts`               → node        · isolate: false  ← 默认，最快
//   `.spec.isolate.ts`       → node        · isolate: true
//   `.spec.dom.ts` / `.tsx`  → happy-dom   · isolate: false  ← 默认
//   `.spec.dom.isolate.ts`   → happy-dom   · isolate: true
//
// **默认 `isolate: false`**（同一个 worker 里连着跑多个文件，模块只求值一次）。理由是判据：框架不该有
// 全局变量——真有全局状态的用例是缺陷，不是给所有人加成本的借口。`.isolate` 后缀是**诊断标签**，
// 只给「确实需要进程级隔离」的（真端口 / 真 sqlite 文件锁 / 真子进程），文件头要写清为什么。
//
// 四个后缀**互不重叠**：`*.spec.ts` 要求文件名以 `.spec.ts` 结尾，`.spec.isolate.ts` 以 `.isolate.ts`
// 结尾，两边不会同时命中，所以不需要靠 `exclude` 拆。
//
// **不要在 project 里设 `maxWorkers`**：那是**每层各自**的上限，多个 project 各设 100% 会变成「N×核数」
// 抢核（实测全量 204s），设 50% 则把每层砍到半核（168s）。worker 数交给 vitest 按机器核数统一分配。
//
// `.tmp/**` 也在排除里：测试的临时目录就落在 `.tmp/`（见下），那里会出现 `*.spec.ts` 的副本
// （federation / bundle 这类用例会复制一整个包树），不能被当成测试收进来。
// `target/**` 用 `**/` 前缀：各 app 自己的 `target/` 里也会落部署副本（`apps/zephyr-custom/target/Zephyr Custom`、
// `apps/zephyr-custom/target/.zephyr-deploy-*`），那里面的 `*.spec.dom.ts` 会在下一轮被当成测试收进来（0 test / 直接失败）。
const EXCLUDE = ["**/node_modules/**", "**/target/**", ".scratch/**", ".tmp/**"];

// 用例的临时目录落在**项目本地**的 `.tmp/<project>/`，而不是机器共享的 tmp 根。
//
// `os.tmpdir()` 读的就是 `TMPDIR`：worker 里改这个变量，**所有** `mkdtemp(join(tmpdir(), …))` 都跟着走，
// 不只是某一条路径。为什么必须换：机器 tmp 根是跨进程共享的，各种工具的产物堆在里面（本机实测 58.8 万条），
// 一次 `readdir(os.tmpdir())` 要 760ms；而每个用例至少一次 `mkdtemp`，上游 spill 的启动清扫还要把 tmp 根
// 整列一遍并把结果 `await` 到 dispose——慢的不是用例，是这层目录列举。换到本地之后：`dsh-agent-loop` +
// `dsh-agent-team` 从 35.8s 降到 13.3s，全量热跑 62.3s → 56.8s。
//
// 落在仓库里是**有意的**：`.tmp/` 已在 `.gitignore` 里（可随时整删），并且被上面的 `EXCLUDE` 挡住不被
// include 收进测试。它与 `.scratch/` 不是一回事：`.scratch/` 放人工的交接 / 票据 / 探针（要能留），
// `.tmp/` 只放测试运行期产物（可随时删、不需要留）。
//
// **卸载顺序（踩过）**：fixture 的清理跑在 `onTestFinished` **之前**。用了 `appEnv` 临时目录的装配，
// 卸载必须登记到 `appEnv.onCleanup(...)`（`packages/zephyr/zephyr-app/src/testing/fixtures.ts` 的清理链），
// 否则会在目录被删之后又写回 `sessions/…`，`.tmp/<project>/` 每轮留残骸。
//
// 目录在配置加载时建（早于任何 worker），不用 globalSetup。
const TEST_TMPDIR = join(import.meta.dirname, ".tmp");

/** happy-dom 的环境补齐（`document.compatMode`，KaTeX 在模块加载时据此判 quirks mode）。细节见那个文件。 */
const UI_SETUP = join(import.meta.dirname, "tool", "vitest", "setup.ui.ts");

/**
 * 四个后缀组合。`name` 同时是 project 名与 `.tmp/` 下的子目录名——一处定义，不写四遍。
 *
 * `isolate: false` 是默认：同一个 worker 连着跑多个文件、模块只求值一次。
 */
const SUITES = [
  {
    name: "node",
    environment: "node",
    pool: "threads",
    isolate: false,
    include: ["**/__tests__/**/*.spec.ts"],
  },
  {
    name: "node-isolate",
    environment: "node",
    isolate: true,
    // `.isolate` 的处方是**真进程**：默认池（threads）是同一进程里的线程，共享模块注册表与原生绑定，
    // 真正需要「干净的模块图 / 独立进程」的文件（整模块 mock、真端口、真子进程、原生绑定会在
    // worker 退出时崩的）在这里换回 `forks`——一个文件一个子进程。
    pool: "forks",
    include: ["**/__tests__/**/*.spec.isolate.ts"],
  },
  {
    name: "ui",
    environment: "happy-dom",
    pool: "threads",
    isolate: false,
    include: ["**/__tests__/**/*.spec.dom.ts", "**/__tests__/**/*.spec.dom.tsx"],
    setupFiles: [UI_SETUP],
  },
  {
    name: "ui-isolate",
    environment: "happy-dom",
    isolate: true,
    pool: "forks",
    include: ["**/__tests__/**/*.spec.dom.isolate.ts", "**/__tests__/**/*.spec.dom.isolate.tsx"],
    setupFiles: [UI_SETUP],
  },
] as const;

/** 一个 project 的临时目录：`.tmp/<project 名>`。 */
function tmpdirOf(name: string): string {
  return join(TEST_TMPDIR, name);
}

export default defineConfig(async () => {
  await Promise.all(SUITES.map(async (suite) => await mkdir(tmpdirOf(suite.name), { recursive: true })));
  return {
    oxc: { decorator: { legacy: true } },
    test: {
      // **`pool` 只在 project 上写，不写在根上**：根上的 `pool` 会盖掉每个 project 自己的选择
      // （实测：根写 `threads` 时，标了 `.isolate` 的 `forks` 层也被拉回 threads，原生崩溃照样把进程带走）。
      projects: SUITES.map((suite) => ({
        test: {
          name: suite.name,
          // worker 里的 `os.tmpdir()` 指向本层目录：夹具的 `mkdtemp`、上游 spill 的启动清扫都跟着走。
          env: { TMPDIR: tmpdirOf(suite.name), TMP: tmpdirOf(suite.name), TEMP: tmpdirOf(suite.name) },
          pool: suite.pool,
          environment: suite.environment,
          include: [...suite.include],
          setupFiles: "setupFiles" in suite ? [...suite.setupFiles] : [],
          exclude: [...EXCLUDE],
          testTimeout: 3000,
          isolate: suite.isolate,
        },
      })),
    },
  };
});