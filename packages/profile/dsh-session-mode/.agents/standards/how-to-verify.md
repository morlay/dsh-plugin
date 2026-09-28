# 如何验证

本包的真源是两份，判据分别钉住它们：`src/mode-sources.ts`（模式定义与各模式的默认模型）→ `src/rows.ts`
渲染出来的行 config（装配入口在 `bundles/session-mode-profile`）→ 运行期行为（persona、收口、默认模型兜底与
preset 平面）。分三层跑，缺一层都有盲区。

## 1. 包内测试（每次改动都跑）

```sh
pnpm exec vitest run packages/profile/dsh-session-mode packages/context/dsh-context-assembler
```

- `bundles/session-mode-profile/src/__tests__/patch.spec.ts`：生成物与 `renderPatch()` 同形；两行（`session-mode`
  与 `context-assembler-scope`）在装配入口那一份里；`preset-mode-switch` 的展示元数据、行清单与
  `TOOLKIT_PRESET_ROWS` 逐行同形、注入面不在其中、两个模式都挂它；配置层把 registry 的默认指向它。
  本包的装配期校验（默认模式在清单里且是 `main` 角色、每个模式有白名单、`role` 非空、`preset` 允许共享、
  `defaultModel` 的 provider 与 model 要给全）在 `session-mode.spec.ts` 里按预期拒绝。
- `src/__tests__/session-mode.spec.ts`：在真依赖（agent-loop testkit + scope 出口）下装一次——
  新会话读到的 persona 是默认模式的、**遮蔽部署级那层**；切到 `chat` 后 persona 换掉、工具目录只剩它那几件、
  动态快照被抑制（成对判据：`coding` 那边必须非空，否则"全局关掉"也能让 chat 通过）；装配幂等；
  已开始的会话拒绝切换；未知模式 / 未知会话拒绝；装配期校验直接拒绝装载。同文件还守着两块新面：
  - **角色**：`idsFor` / `roster()` 只列 `main`；`select` 拒绝非 `main` 的模式；`applyTo`（预留的指定接缝）
    能应用 `subagent` 角色的模式。
  - **默认模型**：新会话的 `agent/request` waterfall 结果是这个模式配的 `defaultModel`；没配的模式不插手；
    会话落过 `request/header`、或用户选过模型（投影 `modelSelection.pending`，用例里注册最小同 key 投影）之后
    不再兜底；子代理继承父模式（投影与 persona 都换过去），父不在场时回落默认。
  - **它是顶层 volatile**：schema 上只有 `models` 带 volatile meta（`modes` 不是）——设置面能编辑的正是它；
    解析之后它是个稳定引用，用例直接对着引用提交一次新值，下一次请求就该读到新值（"设置页保存不重挂这行"
    的判据；引用符号的 home 是 cosmokit 的 `volatile.ts`）。
- `src/__tests__/settings-page.spec.ts`：这一行的 volatile 字段经 host 投影后，字段树里应当有模式清单
  （`modes.<id>.<字段>`，模式是成员行）与按清单列出的 `models` 候选行（`pending`）——用真 `volatileForm` 与真
  `Config`，只把 settings 的读写面换成替身。
- 配置页的**渲染**在通用面测（`client/ui-schema-form`：dict → 每个模式一组字段，保存成
  `{ op: 'set', path: ['models', <模式 id>], value }`）；本包测两件事：schema 上那一处 volatile 标注仍在
  （上一条判据），以及 client 半的字段文案只认领 `models` 下那三个字段（`field-wording.spec.ts`）。
- `src/__tests__/preset-plane.spec.ts`：**两个模式共享自己注册的那份 preset** 时的真装配（真 `Loader` + 真
  registry + 真上游行：行按 app 安装锚点解析）——chat 的目录正好是提问 + 联网三件（三件都真的注册着）、注入
  0 条；coding 的目录里有文件与联网工具，注入只有**一份**技能目录（`id: skill-catalog`、`kind:
context-assembler`）与工作区指令；切 chip（coding ↔ chat）不触发 `recompose`；官方 `standard` 会话照旧
  （工作区指令让位给上游那一行、skill 面仍是我们那一份）。`session-mode.spec.ts` 里另有一组共享 preset 的
  单元判据（装载不被拒、`modeForPreset` 不回答、目标 preset 相同就不换、重复选幂等）。
- `../dsh-context-assembler/src/__tests__/scope/context-assembler-scope.spec.ts`：按会话收口的四条——
  目录只留白名单、`tool:<名字>` section 同源过滤、白名单外调用被拒（文案带定义名）、**再 apply 一次就是换
  一份**（旧 guard 收回，换回去的工具重新可用）；没登记过的会话一律放行。

## 2. 真装配探针（改装配形状时跑）

```sh
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-preset-plane.mts
```

前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
`just custom dev --web` 或 `just custom desktop`）——两个探针都读它；模式那个只读、不建会话，preset 平面那个
建两个空白会话（切模式用）。

**判据**：

- `verify-session-mode.mts`（装配面）：装配层可见 `contextAssembler`（通道全局一份）与 `sessionToolScope`
  （收口行装上了）；`ctx.agentPresets` **存在**（行清单归 preset 平面）；`ctx.sessionModes.roster()` 等于
  config（`coding` / `chat`，默认 `coding`）；`GET /session-mode` 返回 200 且清单相同；`POST /session-mode` 用
  一个不存在的会话打一次，必须拿回我们自己那句「未知的会话」——那条路会读 `ctx.sessions` / `ctx.agents`，而
  cordis 的**属性访问**要求 fiber 在 `inject` 里点过名，漏一个就成了真回归（2026-09-24：`cannot get property
"sessions" without inject`，只跑 GET 与包内测试都看不见——包内测试从 root ctx 调服务，绕开了 inject
  白名单）。
- [`verify-preset-plane.mts`](../../../../desktop/dsh-desktop-host/tool/verify-preset-plane.mts)（preset 平面）：
  真 web profile 里 registry 的默认是 `mode-switch`、名册里那一项装配成功；它的行清单里有 `tool-web` 与
  `skill-filesystem`、**没有** `agent-instructions` / `tool-skill` / `tool-guidance`；新会话（走
  `sessionController.create`）挂上它、模式是 `coding`、目录是**全套**（文件 / Shell / 委派 / workflow / flow /
  联网 / skill）；`chat` 的目录正好三件、注入 0 条；切 chip 不重挂 preset（显式选官方 `standard` 才重挂一次，
  且那一侧工作区指令让位、skill 面仍是我们抢到的）。
  注意：这个探针**会建会话**（落在 dev store 里，`.dsh-store/` 已被 gitignore），与 `verify-session-mode.mts`
  的只读口径不同。
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
