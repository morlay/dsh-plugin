// 契约覆盖守卫已上移到 `@morlay/zephyr`（纯类型工具，不该挂在 app 面）。
//
// 这里保留 re-export：现有调用点大量 `import { AssertCovered } from "@morlay/zephyr-app/client"`，
// 上移是为了去掉错位，不是为了制造一次全仓替换。
export { type AssertCovered, type AssertTrue, type Uncovered } from "@morlay/zephyr";
