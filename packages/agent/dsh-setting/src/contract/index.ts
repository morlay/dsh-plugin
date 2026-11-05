// setting 的契约面：`Setting`（配置文档读写）**已上移到 `@morlay/zephyr-app`**，
// 因为注册机制（schema 注册表 + `@Setting` 装饰器）也是那份契约的消费方，而机制在框架层。
export * from "@morlay/zephyr-app";
