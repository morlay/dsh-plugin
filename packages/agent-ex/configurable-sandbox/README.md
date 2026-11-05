# @morlay/configurable-sandbox

可配置沙箱：替换官方进程沙箱（`ctx.sandbox`）与文件围栏（`ctx.fs`），在官方语义之上叠加额外可写根、
只读根与拒绝项；规则来自 `{DSH_HOME}/sandbox.toml`，启动时读一次。

## 用法

装配函数是 `provideConfigurableSandbox()`（`./`）；它替换官方 `SandboxDefault`（`ctx.sandbox`）与
`FsSandbox`（`ctx.fs`）两个实现。装配清单不在本包。

规则写在 `{DSH_HOME}/sandbox.toml`（**一行一条**，注释用 `#`）：

```toml
access = [
  "rw {{ env.XDG_CACHE_HOME }}", # 追加可写根（必须是具体路径，不收 glob）
  "r- {{ env.XDG_CONFIG_HOME }}", # 只读：读放行、写拒绝
  "-- **/*.pem", # 拒绝：读与写都拒
]
# 可选；空数组 = 按平台自带链选
runnerCommand = []
```

六个字段都能写，缺的按默认值：`access`（`[]`）、`runnerCommand`（`[]`）、`runnerFailureSignatures`（`[]`）、
`probeTimeoutMs`（`5000`）、`cwd`（`process.cwd()`）、`diffBasisMaxBytes`（`10 MiB`）。

改配置文件要**重启**才生效（没有配置页，也没有热重载）。写坏一份 toml 不会让宿主起不来：
整份配置按"没有规则"处理并 `logger.warn` 一条点名（文件路径 + 坏在哪）。坏法包括：不是 TOML、字段类型不对、
条目语法不对、**字段不认识**——多写一个键说明这份文件不是本版本认的形状，挑一半字段生效比一条都不生效更难查。

## 出口

| 出口 | 是什么                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `.`  | 契约（`SandboxRules` / `SandboxFile`）、两个实现、纯逻辑（规则 / 方言 / 包含判定 / 策略文本）与 `provideConfigurableSandbox` |

本包**只有宿主半**：没有浏览器面、不引 `react` / `*.css`。

## 判据

- 规则语义、平台表达能力与降级方式见
  [`20260929-可配置沙箱的规则面与平台降级`](./.agents/designs/20260929-可配置沙箱的规则面与平台降级.md)。
- **配置来源为什么从行 config 改成 toml、替换形态为什么是 `fromCordis` + deps** 见
  [`20261106-配置来源与替换形态`](./.agents/designs/20261106-配置来源与替换形态.md)。
- 验证接缝与环境门控见 [`how-to-verify`](./.agents/standards/how-to-verify.md)。

## 已知限制

- **平台表达能力不对称**：`r-` / `--` 只在 macOS Seatbelt 上完整表达；bwrap 把两者都表达成只读挂载
  （`--` 退化为只拒写），Landlock 与 Windows ACL runner 表达不了子路径规则。`ctx.fs` 侧在所有平台语义
  完整，降级只影响 bash 等子进程；装配期按平台 warn。
- **Windows 的 `rw` 额外授权未实现**：官方 `AclWriteGrant` 有预授权能力，本包只告警不用它。
- **bwrap 参数顺序未实测**：`--bind-try` / `--ro-bind-try` 的"后挂载覆盖先挂载"来自 bwrap 文档，
  没有本仓库的测试证据（本机是 macOS）。
