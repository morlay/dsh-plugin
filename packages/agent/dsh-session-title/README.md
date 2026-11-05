# @morlay/dsh-session-title

会话标题：从首条提示或 LLM 生成一句话标题，让侧栏与列表有可读名字。

## 用法

- 导出：`SessionTitle` 契约与 `SessionTitleDefault`；首条提示的 LLM 实现 `SessionTitleLlm`。
- 装配：`provideSessionTitle`（标题服务）与 `provideSessionTitleLlm`（LLM 生成）。
  两者的默认配置在实现类里，装配面用 `configure` 覆盖。

```ts
bootstrapApplication({
  providers: [
    ...provideSessionTitle(configure(SessionTitleDefault, { maxTitleBytes: 120 })),
    ...provideSessionTitleLlm(),
  ],
});
```

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
接口口径见 [`@morlay/zephyr` 的装配规范](../../zephyr/zephyr/.agents/standards/zephyr-assembly.md)。
