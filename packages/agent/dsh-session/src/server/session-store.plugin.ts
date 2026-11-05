// 上游 `SessionStore` 的**实现类**（cordis Service）：装配面要自己 `new` 它时从这里取。
//
// 契约面已经有同名端口 `SessionStore`（`@Injectable()` 抽象类），所以这里带 `Plugin` 后缀。
export { default as SessionStorePlugin } from "@deepseek-ai/dsh-session";
