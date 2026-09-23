# 如何验证

本包的真源是三份，判据分别钉住它们：`tool/modes.ts`（模式定义）→ `cordis.patch.yml`（装配行）→ 运行期行为
（persona 与收口）。分三层跑，缺一层都有盲区。

## 1. 包内测试（每次改动都跑）

```sh
pnpm exec vitest run packages/profile/dsh-session-mode packages/context/dsh-context-assembler
```

- `src/__tests__/patch.spec.ts`：`cordis.patch.yml` 逐字节等于 `renderPatch()`；两行（`session-mode` 与
  `context-assembler-scope`）的行 id 与名字正确，第二行**就是** `@morlay/dsh-context-assembler/rows` 的
  `scopeRow()`（单一 home）；模式清单逐项等于 `tool/modes.ts` 的源数据（含 `role` 与 `defaultModel`）；
  装配期校验（默认模式在清单里且是 `main` 角色、每个模式有白名单、`role` 非空、`defaultModel` 要么不写要么
  给全 provider + model）按预期拒绝。
- `src/__tests__/session-mode.spec.ts`：在真依赖（agent-loop testkit + scope 出口）下装一次——
  新会话读到的 persona 是默认模式的、**遮蔽部署级那层**；切到 `chat` 后 persona 换掉、工具目录只剩它那几件、
  动态快照被抑制（成对判据：`coding` 那边必须非空，否则"全局关掉"也能让 chat 通过）；装配幂等；
  已开始的会话拒绝切换；未知模式 / 未知会话拒绝；装配期校验直接拒绝装载。同文件还守着两块新面：
  - **角色**：`idsFor` / `roster()` 只列 `main`；`select` 拒绝非 `main` 的模式；`applyTo`（预留的指定接缝）
    能应用 `subagent` 角色的模式。
  - **默认模型**：新会话的 `agent/request` waterfall 结果是模式配的那份；没配的模式不插手；会话落过
    `request/header`、或用户选过模型（投影 `modelSelection.pending`，用例里注册最小同 key 投影）之后不再兜底；
    子代理继承父模式（投影与 persona 都换过去），父不在场时回落默认。
- `../dsh-context-assembler/src/__tests__/scope/context-assembler-scope.spec.ts`：按会话收口的四条——
  目录只留白名单、`tool:<名字>` section 同源过滤、白名单外调用被拒（文案带定义名）、**再 apply 一次就是换
  一份**（旧 guard 收回，换回去的工具重新可用）；没登记过的会话一律放行。

## 2. 真装配探针（改装配形状时跑）

```sh
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts
```

前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次
`just custom dev --web` 或 `just custom desktop`）；脚本只读它，不建会话。

**判据**：

- `verify-session-mode.mts`：装配层可见 `contextAssembler`（通道全局一份）与 `sessionToolScope`（收口行装上了）；
  `ctx.agentPresets` **不存在**（官方那一套已禁用——它还在就是两套并行机制）；
  `ctx.sessionModes.roster()` 等于 config（`coding` / `chat`，默认 `coding`）；`GET /session-mode` 返回 200
  且清单相同；`POST /session-mode` 用一个不存在的会话打一次，必须拿回我们自己那句「未知的会话」——那条路会读
  `ctx.sessions` / `ctx.agents`，而 cordis 的**属性访问**要求 fiber 在 `inject` 里点过名，漏一个就成了真回归
  （2026-09-24：`cannot get property "sessions" without inject`，只跑 GET 与包内测试都看不见——包内测试从
  root ctx 调服务，绕开了 inject 白名单）。
  模式之间的**行为**差异（chat 没有动态快照、目录被收口）不在探针里判——那要建会话、跑装配，代价大于收益；
  第 1 层已经在真依赖下测过同一件事。

## 3. lint（类型是它的一部分）

```sh
just lint
```

类型检查由 oxlint 的 `typeAware` + `typeCheck` 承担（本仓库没有独立 `tsc` 步骤）。改动 client 半或
`declare module` 合并接口时必跑——那两类错误只在类型面出现。
