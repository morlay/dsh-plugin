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

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    projects: [
      {
        test: {
          name: "node",
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
          environment: "happy-dom",
          include: ["**/__tests__/**/*.spec.dom.ts", "**/__tests__/**/*.spec.dom.tsx"],
          exclude: [...EXCLUDE],
          testTimeout: 3000,
          isolate: true,
        },
      },
    ],
  },
});
