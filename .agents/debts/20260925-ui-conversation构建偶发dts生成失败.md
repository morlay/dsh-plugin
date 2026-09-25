# ui-conversation 构建偶发 dts 生成失败

状态：触发中（实测约 1/3 概率；`just build` 红时重跑该包构建即恢复）

**现象**

`pnpm --filter ./packages/session/ui-conversation run build` 偶发失败——同一份源码连续跑三次，退出码 `0 / 0 / 1`：

```
[plugin rolldown-plugin-dts:generate]
Error: tsgo did not generate dts file for …/vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts, please check your tsconfig.
```

CJS 产物（`dist/client.cjs`）照常写出，只有声明生成失败；每次报错的文件集合都不同（三次失败分别落在
`client/contract/{context-producer,conversation,snapshot}.ts`、`client/conversation/{definition-registry,view-registry,assembly,assembler}.ts`、
`client/service.ts` 这些「只被类型引用的契约模块」上，各 16 条错误）。
**串行构建（`pnpm -r --workspace-concurrency=1`）同样复现**；与是否残留 `dist/` 无关（清 `dist` 后单独跑既通过过也失败过）。

**影响**

- 撞上的人：本地 `just build`、换版后的门禁验证、发布前构建。报错指向上游只读源码，看着像适配缺口，实际是构建工具链的 flake。
- 恢复方式：重跑该包构建（多次重试），或 `rm -rf packages/session/ui-conversation/dist` 后重跑（提高成功率、不保证）。

**触发条件**

`just build` 报上述错误时——重跑，不要顺着报错去改上游源码或 tsconfig。

**销账条件**

Done when：该包在重复构建下稳定产出声明（例如 tsdown 透传 `rolldown-plugin-dts` 的 `generator` 后改用 `tsc` / `oxc`，
或该包的 client 入口不再把 vendor 源码 inline 成单文件，或 flake 在上游插件里被修掉）。

**不修的理由**

判据在插件内部：它要求 bundle 里**每个模块**都有 emit 出来的 `.d.ts`（`rolldown-plugin-dts` 的
`dist/index.mjs:236-247` 用 `existsSync(dtsPath)` 判定，缺失即报这条错），而 client 入口 inline 的 vendor 契约模块只被类型引用，
tsgo 是否 emit 它们不稳定。可换的 `generator` 选项 tsdown 0.22.14 并不透传（其 `dist/` 里零命中 `generator`），
换它要动仓库构建链、影响所有带 client 入口的包；而失败重跑即恢复，先记在册。
