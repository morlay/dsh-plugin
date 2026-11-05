// 槽位 props 的**派生类型**（上游 `@deepseek-ai/dsh-client-ui-slots`）：业务组件按它们写 props。
//
// 框架侧只转出、不重写：这五个 share 由渲染器派生，业务代码不该自己再声明一份。
export type { InjectFace, PropsRenderFactories, Translate } from "@deepseek-ai/dsh-client-ui-slots";
