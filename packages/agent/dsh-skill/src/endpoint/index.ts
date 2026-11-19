// skill 域的 **RPC 面**（`@morlay/dsh-skill/endpoint`）：`skills` 组的契约类与两组共用的形状。
//
// 浏览器半（`src/ui`）要从这里取组名与契约，**不引包根**：包根出宿主实现（service / 上游实现类），
// 会把宿主树拖进前端 bundle（audit 的「浏览器半别引包根」规则就是这么判的）。
export * from "./skill-endpoint.ts";
