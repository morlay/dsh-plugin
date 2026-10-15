// 上游同步的步骤清单：`patch` 改上游工作树，`prebuild` 生成源码面消费的产物、编译 native addon。
// 用 TS 写就是为了每个阶段、每条步骤旁边写得下「为什么」。
//
// 执行器与步骤类型见 `devpackages/upstream-sync/src/steps.ts`；两阶段的语义与各步骤类型的判据在
// `dsh-plugin-upstream-sync` 技能里。
import type { Step } from "../scripts/upstream-sync/src/steps.ts";

// 从 sync 的干净基线跑一次（不是每条步骤都幂等）。
export const patch: Step[] = [
  // 上游的非产品面：文档站（依赖我们没装的 vitepress）、仓库脚本、测试快照、基准与 python 工具。
  // 产品面（packages / vendor / native / apps）留下——`apps/cli` 被本仓库的工具与用例当 install anchor。
  // 用 glob 形态（不存在就删 0 项）：这几样是"确保它不在"，不是"上游挪走即失败"的信号。
  { type: "rm", glob: "website" },
  { type: "rm", glob: "scripts" },
  { type: "rm", glob: "snapshots" },
  { type: "rm", glob: "benchmarks" },
  { type: "rm", glob: "python" },
  // 指向上游不入库的测试快照的符号链接（断链）；本仓库不跑这条 acp e2e，删掉免得断链被遍历到。
  // 同样用 glob 形态：快照不入库，`reset` 之后它也不会回来。
  { type: "rm", glob: "apps/cli/tests/profiles/acp/cordis.yml" },
  // 写端双协议：让 typert 的 `Remote`/`RemoteScope` 与 cordis 的 `Inject` 同时接受 TC39 与 legacy
  // 两种调用约定（类型面也一样）——本仓库根 tsconfig 开着 `experimentalDecorators`。
  { type: "git", patch: "decorator-dual-protocol.patch" },
  // subprocess runner 的转译器改由 `DSH_SOURCE_LOADER` 注入（上游默认的 `tsx/esm` 本仓库里没有）。
  { type: "git", patch: "source-loader.patch" },
  // 认证移除：页面与资源都由自研 web 层（vite dev server）提供，这层 cookie 校验只剩阻碍——摘掉它
  // 之后所有 `/api/*` 一律 401（见 `remove-browser-auth.patch` 的说明）。
  { type: "git", patch: "remove-browser-auth.patch" },
  // 渲染期写入：`ui-model-selection` 的目录由 inject 工厂构造，而 renderer 会在**渲染期间**跑那个工厂；
  // 构造里那次 `syncInputs()` 写 store 会触发 React 的
  // "Cannot update a component while rendering a different component"（`DocumentTitle` 订阅了 store）。
  // 把首次同步推到微任务。
  { type: "git", patch: "model-selection-deferred-sync.patch" },
  // 渲染窗口内的 store 写入：`publishRetention` 会在渲染期被调到（`ui-model-selection` 的 inject 工厂在
  // 渲染期 materialize 会话 scope → retain），同步写 sessions store 会让 React 的 `useSyncExternalStore`
  // 在渲染期间发现快照变化并报「Cannot update a component while rendering a different component」。
  // 写入批处理到微任务（结构性更新走微任务本来就是这一层的纪律）。
  { type: "git", patch: "session-retention-batched.patch" },
  // `connection/src/client/rpc.ts` 按值用到 `RpcId`，而 `client/api.ts` / `client/index.ts` 又把它**从这里**
  // 再导出（类型面）。类型被当值处理时（我们这边 `verbatimModuleSyntax: false`）这条链断在 `client/rpc.ts`：
  // `api/remotes` 的 client 面 `export type { …, RpcId, … } from '@deepseek-ai/dsh-client-connection/client'`
  // 会求值成运行导入，浏览器报 `does not provide an export named 'RpcId'`。补一行再导出，两侧同形。
  { type: "git", patch: "connection-client-rpc-reexport.patch" },
  {
    type: "exports",
    // 生成物出口：目标是 `prebuild` 阶段写出的 `.ts`（不是 `lib/*.js`），所以按出口名显式改指。
    generated: {
      "./typert": "./lib/typert.host.ts",
      "./client/typert": "./lib/typert.client.ts",
      "./remote": "./lib/typert.remote-client.ts",
    },
    // 出口名 ≠ 源文件名：这些出口的目标按包显式指定（`lib→src` 同构规则推不出来）。typert 分析
    // 要求每个 export 解析到**存在的**源文件，未映射的出口会让生成失败。
    explicit: {
      "@deepseek-ai/dsh-app-boot": {
        "./worker/profile-resolution-bootstrap":
          "./src/profile-resolution/worker-bootstrap.ts",
      },
      "@deepseek-ai/dsh-client-ui-theme": {
        "./brand-font.css": "./src/styles/brand-font.css",
      },
      "@deepseek-ai/dsh-host-directory-picker-native": {
        "./worker": "./src/win32-dialog-worker.ts",
      },
      "@deepseek-ai/dsh-subprocess-local": { "./runner": "./src/bin.ts" },
    },
  },
  // 删上游全部 tsconfig：口径唯一——按文件就近找 tsconfig 的工具只会读到根上那一份，也不会撞上未开
  // `experimentalDecorators` 的上游口径。typert 的生成走本仓库自己的 AST 生成器，不读它们，所以能在
  // patch 阶段就删干净（`prebuild` 只写产物、不再改上游的配置面）。
  { type: "rm", glob: "**/tsconfig*.json" },
];

// 前置是 sync + patch 的干净基线（上游 tsconfig 已在 patch 末尾删掉；typert 用自建的 AST 生成器）。
export const prebuild: Step[] = [
  // typert 三件套（`lib/typert.{host,client,remote-client}.ts`）：`@local/typert-generator` 按 AST 合成
  // 方法面（源码）与类型面（`target/dts` 声明树，缺了就补一次）。
  { type: "typert" },
  // 只编不得不编译的 addon（`.node` 是二进制产物，源码面消费不了）。
  { type: "native" },
];
