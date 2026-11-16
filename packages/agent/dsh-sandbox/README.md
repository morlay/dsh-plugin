# @morlay/dsh-sandbox

沙箱面：提供者与策略，加上 bash、文件两套受限执行与文件观察策略，给 shell 与 fs 一条共同边界。

## 用法

- 导出：`Sandbox` / `SandboxPolicy` 契约与五个行（提供者、策略、bash、fs、观察策略）。
- 装配：`SandboxModule`。
- `SandboxPolicy.workspaceRoot`（`workspace-write` 的兜底根）不给时取 `AppEnv.defaultWorkingDirectory`：
  环境事实只有一个来源，装配面要另给值就 `configure(SandboxPolicyDefault, { workspaceRoot })`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
