# 如何验证

本包的真源是两份：`src/mode-sources.ts`（模式定义与各模式的默认模型）与 `src/scope.ts`（按会话收口：工具面合成、
执行层 guard、三个开关与两条官方注入面的抑制）→ `src/rows.ts` 渲染出来的行 config（装配入口在
`bundles/session-mode-profile`）→ 运行期行为（persona、收口、默认模型兜底与 preset 平面）。分三层跑，缺一层都有盲区。

## 1. 包内测试（每次改动都跑）

```sh
pnpm exec vitest run packages/profile/dsh-session-mode packages/context/dsh-context-assembler
```

- `bundles/session-mode-profile/src/__tests__/patch.spec.ts`：生成物与 `renderPatch()` 同形；host 平面那几行
  （`session-mode`、`context-assembler`、`subagent`、`tool-guidance`）在装配入口那一份里，**没有单独的收口行**；
  **装配里不再有 agent preset 行**（行清单归 shipped preset）、行数据类行（`tool-web` / `plan-mode` / …）一件都不在；
  子代理那一行**没有 `config`**（中文回报指引不限 preset）；两个模式都不写 `preset` 与 `denyTools`，`chat` 写着
  `allowTools` 收窄到三件（`coding` 留空 = 不设收窄），`coding` 写着 `denyPolicies: [fs/edit-intent]`（`chat` 一份
  policy 名单都没有）。
  本包的装配期校验（默认模式在清单里且是 `main` 角色、`role` 非空、`preset` 允许共享、`defaultModel` 的 provider
  与 model 要给全、policy 名字必须在 `POLICY_NAMES` 里）在 `session-mode.spec.ts` 里按预期拒绝；`allowTools`
  留空**不再**报错。
- `src/__tests__/session-mode.spec.ts`：在真依赖（agent-loop testkit + 收口住在那一行里）下装一次——
  新会话读到的 persona 是默认模式的、**遮蔽部署级那层**；切到 `chat` 后 persona 换掉、工具目录只剩它那几件、
  动态快照被抑制（成对判据：`coding` 那边必须非空，否则"全局关掉"也能让 chat 通过）；装配幂等；
  已开始的会话拒绝切换；未知模式 / 未知会话拒绝；装配期校验直接拒绝装载。同文件还守着三块新面：
  - **角色**：`idsFor` / `roster()` 只列 `main`；`select` 拒绝非 `main` 的模式；`applyTo`（预留的指定接缝）
    能应用 `subagent` 角色的模式。
  - **默认模型**：新会话的 `agent/request` waterfall 结果是这个模式配的 `defaultModel`；没配的模式不插手；
    会话落过 `request/header`、或用户选过模型（投影 `modelSelection.pending`，用例里注册最小同 key 投影）之后
    不再兜底；子代理继承父模式（投影与 persona 都换过去），父不在场时回落默认。
  - **policy 拦截**（真 `ctx.waterfall` + 与 `fs-observation-policy` 同形注册的替身上游：不调 `next()`、write 给
    intent、edit 抛 `FS_NOT_OBSERVED`）：被禁的规则下调用拿到 `undefined`（上游仍被问过一次）；只禁一条时另一条
    照旧交回上游结果；没配名单的模式、**另一个 agent** 的会话、认不出 agent 的直接调用都吃上游原样的结果与拒绝；
    切模式后同一次调用换一份判定；重复应用同一模式不注册新监听器；白名单未命中与 `deny` 优先的合成规则；
    未知名被 `configProblem` 拒绝；换模式就是换一份收口（各自的名单生效）。
  - **volatile 落在 `default` 与 `modes` 上**：schema 上只有这两个字段带 volatile meta（顶层的 `models` 不带，
    它是 `hidden()` 的报错用字段）——设置面能编辑的正是这两个；解析之后它们是稳定引用，下一次请求读到的就是
    引用里的新值（引用符号的 home 是 cosmokit 的 `volatile.ts`）。
- `src/__tests__/settings-page.spec.ts`：这一行的 volatile 字段经 host 投影后，字段树里应当有默认模式
  （`default`）、模式清单（`modes.<id>.<字段>`，模式是成员行；四份名单都是数组，配过的值各占一项）与每个模式自己的
  默认模型（没配时是 `modes.<id>` 下的可添加项，配了就有 `provider` / `model` / `reasoningEffort` 三个位子）——用真
  `volatileForm` 与真 `Config`，只把 settings 的读写面换成替身。
- 配置页的**渲染**在通用面测（[`client/ui-primitives`](../../../../client/ui-primitives/README.md) 的 schema 表单：
  dict → 每个模式一组字段）；本包测两件事：schema 上那两处 volatile 标注仍在（上一条判据），以及 client 半的
  字段文案只认领 `['modes','*','defaultModel',…]` 下那三个字段，两份 policy 名单的候选值只认领
  `['modes','*','allowPolicies'|'denyPolicies','*']`（`field-wording.spec.ts`）。
- `src/__tests__/preset-plane.spec.ts`：**模式不绑 preset、行清单归会话挂的那份**时的真装配（真 `Loader` + 真
  registry + 真上游行：行按 app 安装锚点解析，行清单用 shipped `standard` 同形的那几行）——新会话挂 `standard`、
  模式是 `coding`；chat 的目录正好是提问 + 联网三件（三件都真的注册着）、我们通道这一侧注入 0 条、官方那两条注入面
  也都不进（`skill` 不在模型目录里、真调用被收口拒）；coding 用行清单的全部工具，注入只有**一份**技能目录
  （`kind: skill-catalog`，由官方 `tool-skill` 行发布），工作区指令也只有上游那一份；切 chip（coding ↔ chat）一次
  `recompose` 都不发生；换成一件 chat 工具都没有的 preset 时目录为空（代价照实钉住）；**两条官方注入面成对**：
  `chat` 的 `agent-instructions` 与 `skill-catalog` 都不进（连续三步都丢、inbox 不积压、日志 0 条），显式
  `skills: true` 时目录照旧发布，而 `coding` 那边两条都在（它那两个**注入面**开关 `instructions` / `skills` 都缺省为要，
  所以那边钉的正是"开关为 `true` 时零干预"这一侧）；`skills` 推导的减法那一半也成对钉住：名单留空 +
  `denyTools: [skill]` → 目录不注入，而 `instructions` 没关，上游那条工作区指令照旧在。host 平面里装着**真**
  `fs-observation-policy` 行，成对判 policy 拦截：`coding` 编辑没读过的文件拿到 `undefined`（免"先读后改"），
  `chat` 照旧抛 `FS_NOT_OBSERVED`，而写那条规则两边都照旧给 `createIfAbsent`。`session-mode.spec.ts` 里
  另有一组单元判据（空 `preset` 不碰 registry、`modeForPreset` 不回答、重复选幂等、留空 `allowTools` = 全部工具）。
- `src/__tests__/scope.spec.ts`：按会话收口的几条（经 `ctx.sessionModes.applyTo(agent, <模式 id>)`，与部署里同一个
  入口）——目录只留白名单、`tool:<名字>` section 同源过滤、白名单外调用被拒（文案带模式名）、黑名单内的调用按另一句
  被拒（deny 优先）、**换个模式就是换一份**（旧 guard 收回，换回去的工具重新可用）、`instructions: false` 时通道被关、
  `runtimeContext: false` 只盖住本会话；没收过口的会话（行在它之后才激活）一律放行。

## 2. 真装配探针（改装配形状时跑）

```sh
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts
```

前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
`just custom dev --web` 或 `just custom desktop`）——探针读它，且只读、不建会话。

**判据**：

- `verify-session-mode.mts`（装配面）：装配层可见 `contextAssembler`（通道全局一份），`sessionToolScope` **不存在**
  （收口在 `session-mode` 行内部）；`ctx.agentPresets` **存在**（行清单归 preset 平面）；`ctx.sessionModes.roster()` 等于
  config（`coding` / `chat`，默认 `coding`）；`GET /session-mode` 返回 200 且清单相同；`POST /session-mode` 用
  一个不存在的会话打一次，必须拿回我们自己那句「未知的会话」——那条路会读 `ctx.sessions` / `ctx.agents`，而
  cordis 的**属性访问**要求 fiber 在 `inject` 里点过名，漏一个就成了真回归（`cannot get property
"sessions" without inject`：只跑 GET 与包内测试都看不见——包内测试从 root ctx 调服务，绕开了 inject
  白名单）。
- **preset 平面不进探针**：整条行清单能不能装上、注入面归哪一侧，由包内的真装配用例承担——
  [`preset-plane.spec.ts`](../../src/__tests__/preset-plane.spec.ts)（真 `Loader` + 真 registry + 真上游行：新会话挂
  shipped `standard`、切模式一次 `recompose` 都不发生、chat 收成三件、我们通道注入 0 条、行清单里缺工具的 preset
  上白名单一件都收不到）与
  [`bundles/session-mode-profile` 的 `patch.spec.ts`](../../../../bundles/session-mode-profile/src/__tests__/patch.spec.ts)
  （生成物：装配里不再有 agent preset 行、两个模式都不写 `preset`）。
- **还没进探针的**（改这条装配形状时值得加）：`ctx.settings.describe()` 里能看见 `session-mode` 这个命名空间
  （设置面能编辑 `default` / `modes` 的前提）。它在包内已经钉住（第 1 层的 volatile 用例与 schema 断言），
  探针里加一条只是多一层"真装配也如此"。

## 3. lint（类型是它的一部分）

```sh
just lint
```

类型检查由 oxlint 的 `typeAware` + `typeCheck` 承担（本仓库没有独立 `tsc` 步骤）。改动 client 半或
`declare module` 合并接口时必跑——那两类错误只在类型面出现（例如 `ctx.plugin(plugin, 装配层那份普通对象)`：
它要求 schema 的**源码**形状，而 `apply` 收的是解析后的形状，两者靠 `z<Config, ResolvedConfig>` 分开）。
