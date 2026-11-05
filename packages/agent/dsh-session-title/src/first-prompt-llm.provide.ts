import { provide } from "@morlay/zephyr";
import { SessionTitleLlm } from "./first-prompt-llm.service.ts";

/** 首条提示的 LLM 标题行：默认配置在实现类里，装配面可 `configure` 覆盖。 */
export const provideSessionTitleLlm = provide([SessionTitleLlm]);
