// 上游 `SessionProjectionRegistry` 的**实现类**（cordis Service）：装配面要自己 `new` 它时从这里取。
//
// 契约面只有 `SessionProjectionStore` 端口；实现类属宿主半。
export { default as SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
