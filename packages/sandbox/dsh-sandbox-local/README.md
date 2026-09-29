# @morlay/dsh-sandbox-local

可配置沙箱与审批的**运行时策略面** bundle：替换官方 `ctx.sandbox`（进程沙箱）与 `ctx.fs`（文件系统围栏），在官方
语义之上叠加 `access` 规则——`rw <path>` 追加工作区之外的可写根，`r- <path>` 只读（读放行、写拒绝），
`-- <pattern>` 拒绝访问（读与写都拒）；并接管模型看到的运行时快照（`sandbox:policy` / `approval:policy`）。

## 用法

`access` 的两种写法等价（数组每项一条，或多行文本每行一条；空行忽略）：

```yaml
- id: sandbox-local
  config:
    access:
      - "rw {{ env.XDG_CACHE_HOME }}"
      - "r- {{ env.XDG_CONFIG_HOME }}"
      - "-- mise.*.toml"
      - "-- **/*.pem"
```

- 每条必须以 `rw ` / `r- ` / `-- ` 开头；缺前缀或前缀后没有路径，加载即失败。
- 命中优先级 `--` > `r-` > `rw` / 平台可写根；`r-` / `--` 在 `danger-full-access` 下仍然生效。
- `{{ env.NAME }}` 加载期按进程环境展开（未设置或为空即失败）；相对路径相对**会话工作区**解析。
- `r-` / `--` 接受 glob（`*` / `?` 不跨 `/`，`**` 跨层级，`[!ab]` 取反）；`rw` 必须是具体路径。

字段、规则语义、平台表达能力与装配链路见[设计 可配置沙箱的规则面与平台降级](./.agents/designs/20260929-可配置沙箱的规则面与平台降级.md)。

## 运行时快照（runtime context）

模型每步看到的那段动态快照里，本部署替换掉两条（都在 agent 创建时按 agent 作用域注册同名 context，近的作用域遮蔽
上游在全局层注册的那条；agentless 装配仍读上游那条）：

| context           | 上游文本                                                        | 本包的文本                                                                                          |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sandbox:policy`  | 官方三种 mode 的英文描述                                        | 中文简化版 + 本部署的规则行（`额外可写` / `只读（不可写）` / `拒绝（读写都拒）`）                   |
| `approval:policy` | 英文 `Approval policy: ask…` / `Approval prompts are disabled…` | 按会话有效策略（`ctx.approval` 的 `overrideOf` 优先，否则 `config.policy`，再退 `ask`）选中文那一段 |

注册时机是 agent 创建（`agent/created` + 覆盖已存在的 agent）：`SystemPrompt.assemble()` 先把 `contexts` merge 好
再进瀑布，挂在瀑布里注册只能从**第二次**装配起生效（会话里就是"先英文后中文"）。

## 装配

行数据在本包的 `./rows` 出口（禁官方 `sandbox` / `fs-sandbox` 两行 + 插入本包一行）；采用它的部署 bundle 是
[`@morlay/sandbox-profile`](../../bundles/sandbox-profile/README.md)——它渲染出这份 patch，并在同一份 patch 里按 id
给 `sandbox-local` 的 `access` 值。部署侧只需把那个 bundle 列进 `dsh.profile.bundles`。
