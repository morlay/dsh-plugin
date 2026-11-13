# 如何验证（agent 能力层）

通用部分（证据矩阵、测试落点、等待纪律）在[根规范](../../../../.agents/standards/how-to-verify.md)；这里只写本层的命令与两处特有判据。

## 命令

| 场景     | 命令                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| 单包改动 | `pnpm exec vitest run packages/agent/<包>`                                                  |
| 本层回归 | `pnpm exec vitest run packages/agent`（当前 144 files / 837 tests，9 skipped，约 70s）      |
| 静态检查 | `pnpm exec oxlint packages/agent`（当前 0 errors）                                          |
| 结构判据 | `just audit`（面边界 / 上游包唯一化 / 声明未用 / 扩展边界；逐包跑，见 `justfile`）          |
| 构建     | `just build`（全包；包级图无环——判据是 `pnpm -r --filter './packages/*/*' exec true` 通过） |

## 本层特有判据

- **apps 不设测试门禁**：上层组合由 `just custom build` + 装配清单评审守，不在 apps 里写用例；包内用例**需要起宿主**（真 store / 真 loop / 临时 `dataDir`）时显式给预算（`{ timeout: 180_000 }`）——不是放宽断言，是承认这类用例的成本不在根上的 3s 默认值里。
- **契约套件从 `./testing` 取，不在 spec 里重写**：`runPersistenceContract`（`packages/agent/dsh-session-persistence/src/testing/contract.ts`）、`runCoordinatorContract`（`packages/agent/dsh-session/src/testing/coordinator-contract.ts`）、`FakeWorkspaceRegistry`（`packages/agent/dsh-workspace/src/testing/`）。下游要造同形状数据时，先看上游域的 `./testing` 有没有。
- **假件只造在真正的接缝上**：`dsh-agent/testing` 明确不造 `AgentDirectory` 这类十几成员端口的空壳 fake（等于把契约抄一遍），用它的 spec 应该装真实现。
