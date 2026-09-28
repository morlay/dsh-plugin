# 新 profile 的 dev 模式起不来 client 路由行

状态：**未销账**（只在 dev 模式 + 全新 profile 上复现；生产与已有 home 不受影响）

**现象**

全新 home（`dsh-desktopify dev --web --home <新目录>`，或新机器首次 `just custom dev --web`）启动时多一条警告：

```
dsh: warning: 1 entry did not activate
  dev-client-bundles (@morlay/dsh-desktopify/dev-client-bundles): failed to import
```

页面仍能 boot（client 半走已构建产物），但开发态的 client bundle 路由没有生效。同一个 dev 命令在**已有** home 上不报这条——profile 的 `cordis.patch.yml` 是种子、重种时不被替换，旧那份里没有这一行。

定位线索（未最终定性）：

- 该行由工作区种子插入：`apps/dsh-custom-next/cordis.patch.yml:8-9`（`name: "@morlay/dsh-desktopify/dev-client-bundles"`，按 `DSH_DEV_CLIENT_BUNDLES` 启用）；
- 出口在 dev 态指向 **TS 源**：`packages/desktop/dsh-desktopify/package.json:27`（`"./dev-client-bundles": "./src/dev-client/index.ts"`；发布态 `:36` 才是 `./dist/dev-client-bundles.mjs`），而 `src/dev-client/index.ts` 是 TS（并 import `./combo.ts` 与 `@local/devkit`）；
- host 侧要导入 TS 得靠 tsx：`packages/desktop/dsh-desktopify/src/cli/dev.ts:379-381` 用 `hasTsx(workspace, repositoryRoot)` 决定是否加 `--import=tsx/esm`——新 home 下这个检测大概没命中。

**影响**

新机器 / 新 profile 上做前端开发时，改 client 源码不会被现场打包，只能靠已构建产物；`failed to import` 的警告会一直挂在启动日志里。生产部署与既有开发机不受影响。

**触发条件**

动 dev 流程（`dsh-desktopify dev` / `cli/dev.ts` 的 tsx 检测、种子 patch 的 `dev-client-bundles` 行）之前；或要让「新机器 `just custom dev --web` 开箱可用」之前。

**销账条件**

Done when 全新 `--home` 在 dev 模式下启动不再出现 `1 entry did not activate / dev-client-bundles`，且该行的效果确实生效（改一处 client 源码能观察到现场打包）。

**不修的理由**

本轮交付（bundle 装配入口、槽位与注入面）不依赖它：生产与已有 home 都正常，dev 下页面也能跑。要定位得先备一个私有 `--home` 复现（环境成本），且 `hasTsx` 的判定规则要先读清；眼下记债比顺手改更划算。
