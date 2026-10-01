# 如何验证

通用部分（证据矩阵、测试落点、浏览器半的判据）在[根规范](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包特有的接缝与判据。

## 接缝与对应 spec

| 接缝                                                    | 行为判据                                                                                                                                                                                                         | spec                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `projectNode` / `walkFields` / `seekNode` / `variantOf` | 结构：字段、路径、meta 归一、只读原因、递归收口、判别标签与变体                                                                                                                                                  | `src/__tests__/schema-node.spec.ts`                                                                    |
| `SchemaDraftModel`                                      | 草稿 → path op：只在保存时写一次、非法草稿挡保存、整段校验、丢弃不发写                                                                                                                                           | `src/__tests__/draft.spec.ts`                                                                          |
| `SchemaFormController` / `projectRoot` / `addableAt`    | describe + 共享表单 → 页面读数：字段表按真实键与索引展开、schema 变了草稿不丢                                                                                                                                    | `src/__tests__/controller.spec.ts`、`src/__tests__/real-configs.spec.ts`                               |
| `SchemaFormHints`                                       | 提示面：文案 / 候选键 / 候选值的路径匹配与模板路径、具名源与 `dependsOn`                                                                                                                                         | `src/__tests__/hints.spec.ts`                                                                          |
| `RowRegistration` / `rowRegistrations`                  | 清单 → 槽位注册：key、兜底 priority、差分注销、并发折叠                                                                                                                                                          | `src/__tests__/rows.spec.ts`                                                                           |
| `editorLines` / `visibleFields` / `parseFor`            | 行式视图：行序与折进、折叠、值解析与行内控件动作                                                                                                                                                                 | `src/__tests__/editor.spec.tsx`、`src/__tests__/value.spec.tsx`                                        |
| 截断文本的全文与行内文本的宽度                          | **只有真的被截断**（`scrollWidth > clientWidth`）时注释（含行内校验消息）与值才 hover 出官方 `Tooltip` 气泡且内容是全文，放得下就没有浮层；三处盒子可收缩、自己截断、不撑宽；secret 位只挂原生 `title`、不弹气泡 | `src/__tests__/editor.spec.tsx`、`src/__tests__/value.spec.tsx`                                        |
| `apply`                                                 | 装配面：字典、Factory 的 children 声明、按行注册与 `summary` 不画                                                                                                                                                | `src/__tests__/apply.spec.ts`                                                                          |
| 设置表单原语（搬自上游，判据照抄）                      | 暂存、校验与非法输入、可用性与只读、revision 栅栏、保存失败保留草稿                                                                                                                                              | `src/__tests__/settings-form-model.spec.ts`、`settings-form-fields.spec.tsx`、`settings-form.spec.tsx` |
| 样式层与 token 树                                       | 规则惰性注入与按 id 去重、组件带 `data-css-*`、token 树与上游集合相等                                                                                                                                            | `src/__tests__/styling.spec.tsx`、`token.spec.ts`、`design-tokens.spec.ts`                             |
| 引用解析与渲染                                          | 引用形态归一（手写形态 → 结构化引用与 span）、chip 渲染与 actions                                                                                                                                                | `src/__tests__/reference.spec.ts`、`src/__tests__/reference-markdown.spec.tsx`                         |

## 环境与辅助

- React 渲染用例用文件头 `// @vitest-environment jsdom`，并在 `afterEach(cleanup)`。
- **官方 `Tooltip` 要 `ResizeObserver`**（气泡的可见性由它的回调给），jsdom 没有这个 API：hover 类用例先调
  `stubResizeObserver()`（`src/client/schema-form/testing/resize-observer-stub.ts`）。替身只让气泡进入可见态，
  不是几何证据——**尺寸与定位、以及「值撑不撑宽」只能在浏览器里量**（jsdom 没有布局）：用例钉住可证的契约
  （气泡存在且内容是全文、值槽可收缩、token 是块级盒），真几何靠人工在浏览器里核对。
- **「被截断」的两种状态在 jsdom 里要显式给**：没有布局，`scrollWidth` / `clientWidth` 恒为 0，截断判据永远不成立
  （也就永远不挂浮层）。用例给被测元素定义这两个读数，再调 `notifyResize()` 让替身通知一次——真机上「盒子宽度
  变了」是浏览器通知的，jsdom 里没有那个事件。判据本身（`scrollWidth > clientWidth`）不放宽、不改成字符数阈值。
- 共享替身放 `src/client/schema-form/testing/`：`FakeScope`（内存里的共享配置表单）、`fakeDescribe`（可推动的
  describe 读面）、`stubResizeObserver` + `notifyResize`（jsdom 的 ResizeObserver 替身：前者装上替身，后者让还活着
  的观察者再收一次尺寸通知）。slots / locale / remote 是外部框架面，用最小替身记录注册事实；真实的槽位声明与
  授权校验在上游包内完成。
- 浏览器半的构建判据：`just build` 后产物是**普通 ESM 库**（`dist/client.mjs` + `dist/client.d.mts`），
  不含模块注册外壳——它随消费方内联，带外壳会让页面注册第二个 factory。
- **多份副本的幂等**：`apply.spec.ts`（同一 ctx 装两次只装配一次、服务已在场就不装配）与 `styling.spec.tsx`
  （`vi.resetModules()` 后重取的单例仍是同一份）——inline 后每个消费行产物里各有一份本包代码。

## 本包特有的判据

- **值不回传的字段**（`role: 'secret'`）只有「已配置」状态：文本留空不产生写（`parse` 给 `skip`），
  测试不许断言具体值。
- **只读部署**只挡写：控件禁用、模型层拒写，保存按钮的禁用仍只跟脏 / 非法 / 保存中走（与上游表单壳一致）。
- **schema 变了**（describe 重新描述同一行）只换字段树，草稿与 store 不动——这是「编辑中 host 重读」的行为。
