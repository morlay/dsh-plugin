# 如何验证

通用规则（证据矩阵、测试落点、失败怎么处理）见根[如何验证](../../../../.agents/standards/how-to-verify.md)；
这里只写本包特有的落点。判据与用例都在 [`src/__tests__/`](../../src/__tests__)：

| spec                        | 管什么                                                      |
| --------------------------- | ----------------------------------------------------------- |
| `generate.spec.ts`          | 产物三件套与 wire 细节                                      |
| `schema.spec.ts`            | 类型语法 → zod 的映射                                       |
| `reflection.spec.ts`        | 包反射（JSDoc → description / summary / tags）              |
| `upstream-fixtures.spec.ts` | 对上游真产物形状的快照（逐类型 zod、三种方法的 descriptor） |

上游同步链里它挂在 `vendor/steps.ts` 的 `prebuild` 阶段（`{ type: "typert" }`），步骤与跑法见
[`zephyr-upstream-sync` 技能](../../../../.agents/skills/zephyr-upstream-sync/SKILL.md)。
