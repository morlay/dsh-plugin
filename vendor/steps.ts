// 上游同步的步骤清单：`patch` 改上游工作树，`prebuild` 生成源码面消费的产物、编译 native addon。
// 用 TS 写就是为了每个阶段、每条步骤旁边写得下「为什么」。
//
// 执行器与步骤类型见 `scripts/upstream-sync/src/steps.ts`；两阶段的语义与各步骤类型的判据在
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
  // schemastery 解析会**写回调用方的输入对象**，两处：
  // - `dict`：每个键无条件重写一遍（`data[rKey] = data[key]`），键名没变也写；
  // - `property`：把转换后的值缓存回输入（`data[key] = adapted`），凡是 `z.transform(...)` 字段都会触发。
  // 客户端在非 production 下会深冻结 settings 快照（`@deepseek-ai/dsh-client-store` 的 `devFreeze`），
  // 于是校验抛 `Cannot assign to read only property '<键>'`——配置页因此永远"这一行当前不可写"
  // （`ConfigForm` 解码失败让状态停在 loading），会话里的冻结配置对象也会在解析时炸。
  // 两处都改成"输入只读就不写回"：返回值本来就给了调用方，跳过缓存写不影响语义（见
  // `schemastery-frozen-input.patch`）。
  { type: "git", patch: "schemastery-frozen-input.patch" },
  // 认证移除：页面与资源都由自研 web 层（vite dev server）提供，这层 cookie 校验只剩阻碍——摘掉它
  // 之后所有 `/api/*` 一律 401（见 `remove-browser-auth.patch` 的说明）。
  { type: "git", patch: "remove-browser-auth.patch" },
  // 渲染期写入：`ui-model-selection` 的目录由 inject 工厂构造，而 renderer 会在**渲染期间**跑那个工厂；
  // 构造里那次 `syncInputs()` 写 store 会触发 React 的
  // "Cannot update a component while rendering a different component"（`DocumentTitle` 订阅了 store）。
  // 把首次同步推到微任务。
  { type: "git", patch: "model-selection-deferred-sync.patch" },
  // 渲染窗口内的 store 写入，两处都批处理到微任务（结构性更新走微任务本来就是这一层的纪律）：
  // · `publishRetention`：`ui-model-selection` 的 inject 工厂在渲染期 materialize 会话 scope → retain；
  // · `retainScope` 里 subagent 行的补投影（`projectList`）：`session-maybe` 条目渲染期 materialize scope 时
  //   才出现 subagent 会话，同步写 sessions store 同样报「Cannot update a component (`DocumentTitle`)
  //   while rendering a different component (`SessionMaybeEntryBody`)」。
  { type: "git", patch: "session-retention-batched.patch" },
  // 输入框每次按键都把整份草稿写进 Conversation store，而那个 store 的持久化是**同步**的
  // （`JSON.stringify` + `localStorage.setItem`，见 `client/store` 的 `attachPersistence`）：
  // 一个字符一次全量序列化与写盘，dev 形态下还叠一层 immer 深冻结，draft 越长每键越贵。
  // 把写入节流到 300ms 一次：内容契约不变（最后一次文档仍落盘，`persistCurrentDraft` 立即冲刷，
  // `dispose` 补写尾部），只是不再逐键付序列化成本（见 `draft-persist-throttled.patch`）。
  { type: "git", patch: "draft-persist-throttled.patch" },
  // 会话窗口没有上限：每次 `loadOlder` 都往头部前置一页（`HISTORY_PAGE_OPTIONS`，最多 500 条消息），
  // 实时事件也只追加，`prependWindow`/`appendLive` 从不淘汰——单会话连跑数小时、或反复往上翻之后，
  // 事件、节点与 DOM 行全部常驻。这里加两道内存保险丝：
  // · 已加载窗口：超过 2 万条时丢掉最旧的 2 千条并停止继续分页。取舍写清——被丢的前缀在 Host 上还在，
  //   但不再提供加载，否则「加载回来立刻又被裁掉」会成死循环；代价是超长会话的最早历史在界面上消失
  //   （`hasMore` 变 false，「加载更早」不再出现）。
  // · 流式 transient 帧：每帧都重复 attempt 的元数据与**整段累积文本**，而结算时会被一条 durable 事件
  //   整体取代，所以只保留最近 512 帧（每 256 帧裁一次，裁后以 replace 重发窗口）。堆快照实测：`<64B`
  //   字符串节点 162 万个，其中 `"chunk"` 3 万、模型名 1.8 万、provider 1.8 万、`"。执行。执行。执行"`
  //   这类累积文本副本 2.6 万——都是逐帧留下的。
  { type: "git", patch: "session-window-entry-cap.patch" },
  // 长会话的卡顿主因是**已挂载的行数**：聊天流没有虚拟化，折叠只改 CSS（行仍在 DOM），
  // 于是每一帧的布局与绘制都按整个已加载窗口的规模付钱。给行加 `content-visibility: auto`，
  // 让离屏行跳过自身的布局与绘制——DOM 仍在（锚点、`hidden="until-found"` 搜索、折叠测量都不动），
  // 只有视口附近的行进帧。`contain-intrinsic-size: auto <高度>` 让浏览器记住上次渲染尺寸，
  // 估算只覆盖「从未进入视口」的行。
  // 代价与回滚：跳过渲染的行用估算高度参与布局，长会话中段滚动时 `scrollHeight` 会随渲染补齐而波动，
  // 滚动锚定/折叠动画可能出现跳动；估算基准（72px）与真实行高差得越多越明显。真解决仍是虚拟化。
  { type: "git", patch: "chat-flow-item-content-visibility.patch" },
  // 代码高亮是同步整段 tokenize：`highlightToHtml` 直接调 shiki 的 `codeToHtml`，本机实测 2 000 行
  // ≈190ms、5 000 行 ≈450ms（浏览器更慢），而且**没有结果缓存**——切会话回来、折叠展开、懒加载语法
  // 落地后重渲染，同一段代码要再付一遍（2 000 行重跑仍是 183ms）。
  // 两处都改：① 按「语法 id + 源码」缓存渲染好的 HTML（LRU，总量 8MB 上限；命中实测 0.03ms）；
  // ② 超过 200 行的 settled fence 改成分帧 tokenize（每步 80 行，实测单步最大 11ms、中位 7ms），
  // 用 shiki 的 `grammarState` 串接，结果与整段 tokenize 完全一致（已用脚本逐段比对）。
  // 代价：大块在 tokenize 期间先显示 plain，约 (行数/80) 帧后上色；缓存最多占 8MB HTML。
  { type: "git", patch: "code-highlight-cache-and-chunking.patch" },
  // 语法懒加载的注册（`loadLanguageSync`：把 oniguruma 正则降级成 JS 正则）是**同步原子**长任务。
  // trace（`target/Trace-20261027T152632.json.gz`）里首次渲染某语言的代码块就是 206ms / 114ms 两条长任务，
  // 采样全落在 `toRegExp` / `M$1` / `findNextMatchSync` 上。编译拆不开，但可以不在交互帧里做：
  // 推迟到 `requestIdleCallback`（带 2s 上限，避免代码块一直停在 plain）。
  { type: "git", patch: "grammar-load-idle.patch" },
  // 图标 sprite：`installIconSprite` 给每个 `<symbol>` 各起一次 `DOMParser`（默认集约 60 个），
  // 同一份 trace 的 188ms 长任务里 63% 采样是 `parseFromString`。改成整批拼进一个包装文档只解析一次，
  // 解析后按 id 导入并丢掉 width/height/xmlns/class/aria-hidden（与原逐图标路径同一属性集）。
  { type: "git", patch: "icon-sprite-batch-parse.patch" },
  // 会话列表投影：每个控制帧都重建并 `list.set` 一份新的 ids/byId，订阅者随之全量重渲染。
  // 先做「内容没变就不发布」：顺序、行引用、phase、投影表任一变化才 set（重建本身的成本另算）。
  { type: "git", patch: "session-list-snapshot-dedupe.patch" },
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
        "./worker/profile-resolution-bootstrap": "./src/profile-resolution/worker-bootstrap.ts",
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
