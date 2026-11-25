import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const EXCLUDE = ["**/node_modules/**", "target/**", ".scratch/**"];

// 用例的临时目录落在自己的子目录里，而不是机器共享的 tmp 根。
//
// tmp 根是**跨进程共享**的，各种工具的产物堆在里面（本机实测 58.8 万条）：一次 `readdir(os.tmpdir())`
// 要 760ms，而每个用例至少一次 `mkdtemp`，上游 spill 的启动清扫还要把 tmp 根整列一遍并把结果 `await`
// 到 dispose——慢的不是用例，是这层目录列举。指到自己的子目录之后，同样两条命令（`dsh-agent-loop` +
// `dsh-agent-team`）从 35.8s 降到 13.3s。
//
// 放子目录而不是仓库内：tmp 里的东西是运行期状态，不该出现在工作树里（否则会被 include 或 lint 扫到）。
// 目录在配置加载时建（早于任何 worker），不用 globalSetup。
const TEST_TMPDIR_BASE = tmpdir();
const TEST_TMPDIR = TEST_TMPDIR_BASE.endsWith("dsh-plugin-vitest-tmp")
  ? TEST_TMPDIR_BASE
  : join(TEST_TMPDIR_BASE, "dsh-plugin-vitest-tmp");
const ENV = { TMPDIR: TEST_TMPDIR, TMP: TEST_TMPDIR, TEMP: TEST_TMPDIR };

export default defineConfig(async () => {
  await mkdir(TEST_TMPDIR, { recursive: true });
  return {
    oxc: { decorator: { legacy: true } },
    test: {
      projects: [
        {
          test: {
            name: "node",
            env: { ...ENV },
            environment: "node",
            include: ["**/__tests__/**/*.spec.ts"],
            exclude: [...EXCLUDE],
            testTimeout: 3000,
            isolate: true,
          },
        },
        {
          test: {
            name: "ui",
            env: { ...ENV },
            environment: "happy-dom",
            include: ["**/__tests__/**/*.spec.dom.ts", "**/__tests__/**/*.spec.dom.tsx"],
            exclude: [...EXCLUDE],
            testTimeout: 3000,
            isolate: true,
          },
        },
      ],
    },
  };
});