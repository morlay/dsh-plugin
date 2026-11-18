// session 的**浏览器半**：只出跨端契约的客户端形态（宿主侧实现是 `src/server/`）。
//
// 这里不引宿主专属的包根：`../endpoint/index.ts` 是两端共用面，客户端类只多一个 `Remote` 字段。
export { SessionEndpointClient } from "./session-endpoint-client.ts";
