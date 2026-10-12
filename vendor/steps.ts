// 上游同步的步骤清单：`patch` 改上游工作树，`prebuild` 生成源码面消费的产物、编译 native addon。
// 用 TS 写就是为了每个阶段、每条步骤旁边写得下「为什么」。
//
// 执行器与步骤类型见 `.agents/skills/dsh-plugin-upstream-sync/scripts/steps.ts`；两阶段的语义与
// 各步骤类型的判据在 `dsh-plugin-upstream-sync` 技能里。
import type { Step } from "../.agents/skills/dsh-plugin-upstream-sync/scripts/steps.ts";

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
  // 开发态的 `/plugins` 前缀交给 `dev-client-bundles`（按文件 ESM 直访）：它提供 `devClientRoute` 服务时
  // client-modules 让出前缀，否则两条 prefix 路由同名冲突。打包形态没有该服务，行为不变。
  { type: "git", patch: "client-route-handover.patch" },
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
        "./worker/profile-resolution-bootstrap": "./src/profile-resolution/worker-bootstrap.ts",
      },
      "@deepseek-ai/dsh-client-ui-theme": { "./brand-font.css": "./src/styles/brand-font.css" },
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
