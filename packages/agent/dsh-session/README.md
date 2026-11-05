# @morlay/dsh-session

会话的**数据面**：存储、投影、查询、token 计量的契约与默认实现，外加 `session/*` 的两端契约与测试支撑。
本包没有 `./ui` 面：会话界面不属本包。

## 用法

- 契约（`@Injectable() abstract class`）：`SessionStore` / `SessionProjectionStore` /
  `SessionQuery` / `SessionProjectionCache` / `TokenMeter`；实现在同目录的 `*Default`。
  持久化的契约与实现**不在本包**：用 `@morlay/dsh-session-persistence`。
- 装配（宿主半，`./server`）：`provideSession` / `provideSessionProjection` /
  `provideSessionProjectionCache` / `provideSessionQuerySqlite` / `provideTokenMeter` /
  `provideSessionsHost`。
- 两端契约（`./endpoint`）：`SessionId` 等身份与 `session/*` 的 wire 形状。
- 测试支撑（`./testing`）：造日志的 fixtures、`runCoordinatorContract`、`createSessionContext`。

```ts
bootstrapApplication({ providers: [...provideSession(), ...provideSessionProjection()] });
```

## 边界

- **没有 `./ui` 面**：数据面不持有任何浏览器半的实现。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)；
接口口径见 [`@morlay/zephyr` 的装配规范](../../zephyr/zephyr/.agents/standards/how-to-write.md)。
