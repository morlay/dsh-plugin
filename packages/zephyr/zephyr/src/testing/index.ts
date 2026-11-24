// 框架的**测试面**：业务包的测试只从这里拿测试入口。
//
// DI 的内部表示（令牌元数据、契约面、注入占位、局部替身）是装配器的实现细节，不进这个出口，
// 也不该被业务测试读到：想知道「装配对不对」就按行为断言——`app.get(令牌)` 拿到实例，
// 或它被注入到某处后表现正确；要替身就写 `{ provide: 令牌, useValue: ... }`。
//
// 临时目录不在这里：它是 `AppEnv` 的实现细节（`@morlay/zephyr-app/testing` 的 `appEnv` fixture）。
export { describe, expect, test } from "vitest";
