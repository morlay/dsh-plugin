# profile 的用户 patch 里残留着 app 的装配行

状态：未销账（升级后合成结果里同一 id 出现两行，只挂一份，功能无影响）

**现象**

2026-09-22 之前，打包把 app 自己的 `cordis.patch.yml` 种进 profile，所以老用户的
`$DSH_HOME/profiles/desktop/cordis.patch.yml` 里除了自己的 settings 行，还留着 app 的
`insert: dev-client-bundles`。改成「app 层随 runtime 分发、由 host 作为 overlay 层加载」之后，重种时按
用户数据保留那份文件（[`seed.ts` 的 `ensureSeedProfile`](../../src/seed.ts)），**不清理**其中属于 app 层的行；
于是合成 `composeEntries([...profilePatches, ...overlays])` 里同一 id 出现两行。

**影响**

- 功能上幂等：loader 的 group 用 `Object.fromEntries(config.map(options => [options.id, options]))` 建索引后
  按 id 创建，重复行只挂一份（2026-09-22 实测：两份同 id 的 `insert` 行合成出两行，最终只挂一个 entry）。
- 可见的冗余：`--dump-config` / 配置投影里同一行出现两次。
- 若用户改过 app 层那一行的 config，用户那份被 overlay 覆盖——这是分层语义本身（app 层高于用户层），不是这里的问题。

**触发条件**

升级前用过打包形态、且在 `profiles/desktop/cordis.patch.yml` 里留下过 app 装配行的机器。

**销账条件**

Done when：打包器在重种时能识别并移除用户 patch 里属于 app 层的行（需要按 app 层 id 集合改写 YAML，保留注释与
`!!js` 表达式），或上游把「安装层 patch」与「用户 patch」在投影里分开呈现。

**不修的理由**

清理要引入 YAML 依赖并改写用户文件（注释、`!!js` 表达式、行序都得原样保住），收益只是去重；loader 已按 id 去重，
不影响装配结果。
