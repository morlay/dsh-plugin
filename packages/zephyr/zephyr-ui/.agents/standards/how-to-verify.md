# 如何验证

通用部分（证据矩阵、测试落点、浏览器半的判据）在[根规范](../../../../../.agents/standards/how-to-verify.md)；这里只写本包特有的接缝与判据。

命令：`pnpm exec vitest run packages/zephyr/zephyr-ui`（从仓库根）；产物面 `just build`。

## 接缝与对应 spec

| 接缝                                                 | 行为判据                                                                                                                                                                                              | spec                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `projectNode` / `walkFields` / `variantOf`           | 结构：字段、路径、meta 归一、只读原因、递归收口、判别标签与变体                                                                                                                                       | `src/client/__tests__/schema-node.spec.ts`                                               |
| `SchemaDraftModel`                                   | 草稿 → path op：只在保存时写一次、非法草稿挡保存、整段校验、丢弃不发写                                                                                                                                | `src/client/__tests__/draft.spec.ts`                                                     |
| `SchemaFormController` / `projectRoot` / `addableAt` | describe + 共享表单 → 页读数：字段表按真实键与索引展开、schema 变了草稿不丢                                                                                                                           | `src/client/__tests__/controller.spec.ts`、`real-configs.spec.ts`                        |
| `SchemaFormHintsDefault`                             | 提示面：文案 / 候选键 / 候选值的路径匹配与模板路径、具名源与 `dependsOn`                                                                                                                              | `src/client/__tests__/hints.spec.ts`                                                     |
| `schemaFormHintsOf`                                  | 提示面是 `apply` 在运行期挂的：按字面名读得到、没人挂时是 `undefined`；`inject(SchemaFormHints)` 被 `ProvidersCoverage` 在**编译期**拒绝（`@ts-expect-error` 钉住，不用 `as never` 抹）               | `src/client/__tests__/hints-injection.spec.ts`                                           |
| `editorLines` / `visibleFields` / `parseFor`         | 行式视图：行序与折进、折叠、值解析与行内控件动作                                                                                                                                                      | `src/client/__tests__/editor.spec.tsx`、`value.spec.tsx`                                 |
| 截断文本的全文与行内文本的宽度                       | 只有真的被截断（`scrollWidth > clientWidth`）时注释（含行内校验消息）与值才 hover 出官方 `Tooltip`，内容是全文；放得下就没有浮层；secret 位只挂原生 `title`                                           | `editor.spec.tsx`、`value.spec.tsx`                                                      |
| `apply`                                              | 装配面：提示面、字典、Factory 的 children 声明；多份副本只装配一次                                                                                                                                    | `src/client/__tests__/apply.spec.ts`                                                     |
| 设置表单原语（搬自上游，判据照抄）                   | 暂存、校验与非法输入、可用性与只读、revision 栅栏、保存失败保留草稿                                                                                                                                   | `settings-form-model.spec.ts`、`settings-form-fields.spec.tsx`、`settings-form.spec.tsx` |
| 设置面控件（`controls/`）                            | 标签输入的回车 / 粘贴 / 移除 / 候选菜单只列未加的项、图标按钮的无障碍名与方形几何、选择器的当前值与「没写」那一档、模型路由清单的分组 / 单选 / 三种状态行、字段行的两种排法 / 分隔线 / 徽标与恢复默认 | `controls.spec.tsx`、`field-row.spec.tsx`                                                |
| 引用解析与渲染                                       | 引用形态归一（手写形态 → 结构化引用与 span）、chip 渲染与 actions                                                                                                                                     | `src/__tests__/reference.spec.ts`、`reference-markdown.spec.tsx`                         |

## 环境与辅助

- React 渲染用例用文件头 `// @vitest-environment happy-dom`，并在 `afterEach(cleanup)`。
- **官方 `Tooltip` 要 `ResizeObserver`**（气泡的可见性由它的回调给），happy-dom 没有这个 API：hover 类用例先调 `stubResizeObserver()`（`src/client/schema-form/testing/resize-observer-stub.ts`）。替身只让气泡进入可见态，**不是几何证据**——尺寸与定位、以及「值撑不撑宽」只能在浏览器里量。
- **「被截断」的两种状态要显式给**：没有布局时 `scrollWidth` / `clientWidth` 恒为 0，截断判据永远不成立（也就永远不挂浮层）。用例给被测元素定义这两个读数，再调 `notifyResize()` 让替身通知一次。判据本身（`scrollWidth > clientWidth`）不放宽、不改成字符数阈值。
- 共享替身放 `src/client/schema-form/testing/`：`FakeScope`（内存里的共享配置表单）、`fakeDescribe`（可推动的 describe 读面）、`discriminatedConfig`（判别式配置的样例 schema）、`stubResizeObserver` + `notifyResize`。slots / locale 是外部框架面，用最小替身记录注册事实。
- 本包没有 `tsdown.config.ts`：构建走仓库根 `just build`，产物是**普通 ESM 库**，不含模块注册外壳——它随消费方内联，带外壳会让页面注册第二个 factory。

## 本包特有的判据

- **值不回传的字段**（`role: 'secret'`）只有「已配置」状态：文本留空不产生写（`parse` 给 skip），测试不许断言具体值。
- **只读部署**只挡写：控件禁用、模型层拒写，保存按钮的禁用仍只跟脏 / 非法 / 保存中走（与上游表单壳一致）。
- **schema 变了**（describe 重新描述同一行）只换字段树，草稿与 store 不动——这是「编辑中 host 重读」的行为。
- **多份副本的幂等**：`apply.spec.ts`（同一 ctx 装两次只装配一次、服务已在场就不装配）——inline 后每个消费行产物里各有一份本包代码。
