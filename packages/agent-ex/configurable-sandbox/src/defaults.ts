// 默认的 `{DSH_HOME}/sandbox.toml`：文件不存在时写这一份，用户照着改。
//
// 内容与源部署（`@morlay/sandbox-profile` 的 patch）**逐条一致**——那些条目是「本机真跑得起来」的
// 最小集合：临时目录可写、agent-browser 与 XDG 的缓存/状态/数据可写、XDG 配置只读、
// mise 配方与私钥一律拒绝。空规则（一条都不给）会让沙箱退化成「只有工作区可写」，
// 症状是 agent-browser 起不来、`XDG_CACHE_HOME` 写不进去。
//
// 语法：一行一条，`rw <路径>` 可写 / `r- <路径>` 只读 / `-- <模式>` 拒绝。
// `{{ env.NAME }}` 在加载期展开；相对路径按 `cwd`（缺省是进程工作目录）解析。
export const DEFAULT_SANDBOX_TOML = `
# 本机可写：临时目录（构建工具、npm、各种 tmp）
access = """
rw /tmp
rw {{ env.HOME }}/.agent-browser
rw {{ env.XDG_CACHE_HOME }}
rw {{ env.XDG_STATE_HOME }}
rw {{ env.XDG_DATA_HOME }}
r- {{ env.XDG_CONFIG_HOME }}
-- mise.*.toml
-- **/*.pem
"""

# runner 探测超时（毫秒）：平台自带的链选不出可用 runner 时的兜底上限。
probeTimeoutMs = 5000

# 覆盖写差异的单侧字节上限（10 MiB）。
diffBasisMaxBytes = 10485760
`;
