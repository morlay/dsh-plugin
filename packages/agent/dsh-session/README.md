# @morlay/dsh-session

会话核心：存储、投影、查询、token 计量与浏览器侧会话数据面；标题、检查点等子域在各自包里。

## 用法

- 契约（`@Injectable() abstract class`）：`SessionStore` / `SessionProjectionStore` /
  `SessionQuery` / `SessionProjectionCache` / `TokenMeter`；实现在同目录的 `*Default`。
  持久化的契约与实现**不在本包**：用 `@morlay/dsh-session-persistence`。
- 装配（宿主半，`@morlay/dsh-session/server`）：`provideSession` / `provideSessionProjection` /
  `provideSessionProjectionCache` / `provideSessionQuerySqlite` / `provideTokenMeter` /
  `provideSessionRemote`。
- 装配（浏览器半，`@morlay/dsh-session/ui`）：`provideSessionsStore` / `provideSessions` /
  `provideSessionShell` / `provideSessionSlots` / `provideSessionInputSlots`。

```ts
bootstrapApplication({ providers: [...provideSession(), ...provideSessionProjection()] });
```

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
接口口径见 [`@morlay/zephyr` 的装配规范](../../zephyr/zephyr/.agents/standards/zephyr-assembly.md)。
