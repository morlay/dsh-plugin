# 如何验证

通用部分（证据矩阵、测试落点、浏览器半的判据）在[根规范](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包特有的接缝与判据。

## 接缝与对应 spec

| 接缝                                                    | 行为判据                                                                      | spec                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `projectNode` / `walkFields` / `seekNode` / `variantOf` | 结构：字段、路径、meta 归一、只读原因、递归收口、判别标签与变体               | `src/__tests__/schema-node.spec.ts`                                                                    |
| `SchemaDraftModel`                                      | 草稿 → path op：只在保存时写一次、非法草稿挡保存、整段校验、丢弃不发写        | `src/__tests__/draft.spec.ts`                                                                          |
| `SchemaFormController` / `projectRoot` / `addableAt`    | describe + 共享表单 → 页面读数：字段表按真实键与索引展开、schema 变了草稿不丢 | `src/__tests__/controller.spec.ts`、`src/__tests__/real-configs.spec.ts`                               |
| `SchemaFormHints`                                       | 提示面：文案 / 候选键 / 候选值的路径匹配与模板路径、具名源与 `dependsOn`      | `src/__tests__/hints.spec.ts`                                                                          |
| `RowRegistration` / `rowRegistrations`                  | 清单 → 槽位注册：key、兜底 priority、差分注销、并发折叠                       | `src/__tests__/rows.spec.ts`                                                                           |
| `editorLines` / `visibleFields` / `parseFor`            | 行式视图：行序与折进、折叠、值解析与行内控件动作                              | `src/__tests__/editor.spec.tsx`、`src/__tests__/value.spec.tsx`                                        |
| `apply`                                                 | 装配面：字典、Factory 的 children 声明、按行注册与 `summary` 不画             | `src/__tests__/apply.spec.ts`                                                                          |
| 设置表单原语（搬自上游，判据照抄）                      | 暂存、校验与非法输入、可用性与只读、revision 栅栏、保存失败保留草稿           | `src/__tests__/settings-form-model.spec.ts`、`settings-form-fields.spec.tsx`、`settings-form.spec.tsx` |
| 样式层与 token 树                                       | 规则惰性注入与按 id 去重、组件带 `data-css-*`、token 树与上游集合相等         | `src/__tests__/styling.spec.tsx`、`token.spec.ts`、`design-tokens.spec.ts`                             |
| 引用解析与渲染                                          | 引用形态归一（手写形态 → 结构化引用与 span）、chip 渲染与 actions             | `src/__tests__/reference.spec.ts`、`src/__tests__/reference-markdown.spec.tsx`                         |

## 环境与辅助

- React 渲染用例用文件头 `// @vitest-environment jsdom`，并在 `afterEach(cleanup)`。
- 共享替身放 `src/client/schema-form/testing/`：`FakeScope`（内存里的共享配置表单）、`fakeDescribe`（可推动的
  describe 读面）。slots / locale / remote 是外部框架面，用最小替身记录注册事实；真实的槽位声明与授权校验
  在上游包内完成。
- 浏览器半的构建判据：`just build` 后 `dist/client.cjs` 里 `window.__ModuleLoader__.load` 只出现一次
  （多一次就是内联了别的 client 行，页面会重复注册）。

## 本包特有的判据

- **值不回传的字段**（`role: 'secret'`）只有「已配置」状态：文本留空不产生写（`parse` 给 `skip`），
  测试不许断言具体值。
- **只读部署**只挡写：控件禁用、模型层拒写，保存按钮的禁用仍只跟脏 / 非法 / 保存中走（与上游表单壳一致）。
- **schema 变了**（describe 重新描述同一行）只换字段树，草稿与 store 不动——这是「编辑中 host 重读」的行为。
