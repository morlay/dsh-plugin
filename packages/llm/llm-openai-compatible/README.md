# @morlay/dsh-llm-openai-compatible

DeepSeek Harness 的 **OpenAI 兼容 LLM 适配器**：`providers` 是 dict 多路由（**key 就是 provider 路由键**），每个
profile 除了端点与模型目录，还能声明 **profile 级默认采样参数**（`temperature` / `topP` / `topK` /
`presencePenalty` / `frequencyPenalty` / `seed`）——请求级 `GenerateOptions.temperature` 优先于 profile 默认，缺省
一律不发送（= 提供方默认）。传输层复用
**[@ai-sdk/openai-compatible](https://www.npmjs.com/package/@ai-sdk/openai-compatible)**，本插件只做 harness
适配：消息 → AI SDK prompt、采样合并、stream part → `StreamChunk`、错误归一化与凭据策略。

**与官方 `llm-pi-ai` 二选一**：两者都提供 openai-compatible 的 `providers` dict 与同名 provider 路由，同装会有
两套适配器抢同一批路由，一个部署只装一个。本部署装的是官方那行——它的 `ollama` route 由
[`@morlay/ollama-provider-profile`](../../bundles/ollama-provider-profile/cordis.patch.yml) 配置；只有需要 profile
级采样默认值时才换成这一行。

## 用法

配置写在这一行的 config 里（bundle patch / profile patch / 设置页都落到这里）：

```yaml
- id: llm-openai-compatible
  name: "@morlay/dsh-llm-openai-compatible"
  config:
    providers:
      ollama:
        apiKeyEnv: OLLAMA_API_KEY
        baseURL: https://ollama.com/v1
        displayName: Ollama Gateway
        temperature: 1
        topP: 0.95
        reasoning: high
        models:
          - id: deepseek-v4-flash:0731
            name: DeepSeek V4 Flash
            contextWindow: 1000000
            maxTokens: 65535
            inputModalities: [text, image]
            reasoningEfforts: { off: null, high: high, max: max }
```

`providers` 标了 `.volatile()`——**运行期可改**：值经 Loader 的引用读取，设置页（Models 页）改的就是它，不需要
重挂这行插件。字段清单（端点与请求头、采样、模型目录、传输与重试）、wire 落点与省略语义、错误映射、凭据与图片
策略都在各自 ADR 里；`$DSH_HOME/settings.yaml` 里同名的段由上游在启动时导入同 id 的行 config。
