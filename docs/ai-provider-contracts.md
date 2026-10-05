# 五平台文本规划接口契约

核对日：2026-10-05。仅核对公开官方文档，未使用任何真实 Key 或发起 API 请求。本文及测试证明请求/响应适配逻辑，不证明账号权限、余额、模型在线可用性或生成效果。以下型号是文档核实样例，不保证每个地域均可用，也不自动替换用户设置。

## 共同边界

仅发送一次非流式 Chat Completions POST。共享 Task4 的官方主机/完整路径白名单、公网 DNS 固定连接与原域名 TLS 校验；120 秒总超时，响应上限 1 MiB。不重定向、重试、换平台、续写、调用工具或自动修复 JSON。不发送 `tools`、搜索配置、`temperature` 或 `response_format`；JSON 结构由固定提示词要求，再在本机校验，不宣称所有手填模型都支持平台强制结构化输出。

鉴权仅置于请求头，正文仅包含本次旅行输入及清洗后的搜索摘要，没有 Key、其他行程或草稿。模型名称沿用保存配置；仅对下面精确核实的型号添加思考开关，不按任意名字前缀猜测。未知名称仍可按该平台的基础文本协议调用；若不支持参数、输出模式或权限，安全报错，绝不自动更换 token 参数试第二次。

## 契约对照

| 平台 | 完整地址/路径 | 请求头 | 输出上限字段 | 已核实的非思考文本样例 |
| --- | --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/chat/completions`，亦允许 `/v1/chat/completions` | `Authorization: Bearer <Key>` | `max_tokens: 8192` | `deepseek-flash`、`deepseek-v4-pro`，`thinking.type=disabled` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `Authorization: Bearer <Key>` | `max_tokens: 8192` | `glm-4.7`、`glm-5.2`，`thinking.type=disabled` |
| 小米 MiMo | `https://api.xiaomimimo.com/v1/chat/completions` | `api-key: <Key>` | `max_completion_tokens: 8192` | `mimo-v2.6-flash`，`thinking.type=disabled` |
| Kimi 标准 API | `https://api.moonshot.cn/v1/chat/completions`；国际主机 `api.moonshot.ai` 同路径 | `Authorization: Bearer <Key>` | `max_completion_tokens: 8192` | `kimi-k2.6`，`thinking.type=disabled` |
| 千问 | 该地域/业务空间官方主机下 `/compatible-mode/v1/chat/completions` | `Authorization: Bearer <Key>` | 已核实新型号 `max_completion_tokens: 8192`；旧型号/未知名称 `max_tokens: 8192` | `qwen3.6-plus`，`enable_thinking=false` |

所有请求明确 `stream=false`。8192 是应用请求的生成上限，不是人民币金额或保证实际输出恰好不超上限；各平台的 Token 口径、模型实施及实际计费以平台为准。特别是千问官方提示完整输出上限与实际输出可能有少量 Token 误差。用量缺失时不估算账单。

## 官方依据与型号差异

### DeepSeek

[Chat Completions 官方参考](https://api-docs.deepseek.com/api/create-chat-completion/)、[首次调用与鉴权](https://api-docs.deepseek.com/)、[v1 完整路径示例](https://api-docs.deepseek.com/quick_start/agent_integrations/workbuddy/)。核实文本 messages、`max_tokens`、思考开关、非流式及完成原因。当前参考列出 `deepseek-flash` 和 `deepseek-v4-pro`；两者明确发送禁用思考。其他手填名称不附加该开关，不把旧型号或别名当作最新默认。

### 智谱

[对话补全官方参考](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)、[可读 Markdown/OpenAPI](https://docs.bigmodel.cn/api-reference/模型-api/对话补全.md)。已核实 Bearer、`max_tokens`、`stream=false` 及 `ChatThinking`。精确为 `glm-4.7`、`glm-5.2` 关闭思考；最新 `glm-5.3` / `glm-5.3-flash` 文档明确只能开启思考，不能套用 `disabled`。这些及其他未知型号不发送未经确认的关闭参数；只读取最终 content，不读取 reasoning_content。

模型接口与独立 `web_search` 不同，本适配不附带搜索工具。标准 API 和 Coding 专用路径不可互换。

### 小米 MiMo

[完整官方 Chat Completions 参考](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)。动态旧入口不完整时，已通过官方文档路由找到完整页面；核实 `api-key`、`max_completion_tokens`（含可见输出与推理）、非流式、完成原因与 `thinking.type`。同样明确关闭思考的精确型号为 `mimo-v2.6-flash`、`mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`、`mimo-v2.5-pro`、`mimo-v2.5`。没有盲用别的平台 `max_tokens`。不接批处理、Token Plan、语音或 Anthropic 端点。

### Kimi

[标准 Chat Completions 官方参考](https://platform.kimi.com/docs/api/chat)、[Markdown/OpenAPI](https://platform.kimi.com/docs/api/chat.md)、[国际官方主机说明](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/providers)。旧文档域名 `platform.moonshot.cn` 当前跳转到 Kimi 平台。当前参考已弃用 `max_tokens`，适配使用 `max_completion_tokens`，核实 `stream=false` 与最终 content。`kimi-k2.6` 支持禁用思考；`kimi-k3` 与 `kimi-k2.7-code` 不套用此开关。旧型号是否仍支持新上限参数由平台决定，不自动用第二次请求补救。

仅接标准 Moonshot API，不能把 Kimi 聊天会员或 Kimi Code 的 Key 当作此处标准 API 凭据。

### 千问

[官方 Chat 参数参考](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[思考模式与型号表](https://help.aliyun.com/zh/model-studio/deep-thinking/)、[兼容接口与非流式响应](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[地域/业务空间地址](https://help.aliyun.com/zh/model-studio/regions)。精确新型号 `qwen3.5-plus/flash`、`qwen3.6-plus/flash`、`qwen3.7-plus/flash/max`、`qwen3.8-max/flash` 使用完整输出上限字段；其他自填名称保留仍受支持的旧 `max_tokens`，不猜测所属版本。精确 hybrid 型号及旧 `qwen-plus`、`qwen-flash`、`qwen-turbo` 发送 `enable_thinking=false`；未核实可关闭思考的 `qwen3.8-*` 不附加此开关。

保留已核实旧 DashScope 主机，并支持六个已核实地域的单层业务空间主机，规则见 `provider-registry.mjs`；不接任意 `aliyuncs.com` 子域。Key 与地域必须匹配；不会自动迁移用户目的地或凭据。

## 响应与验证边界

只读取 `choices[0].message.content`。仅 `finish_reason=stop`、无实际工具/函数调用、无拒绝信号且非空的字符串正文可继续。`length` 明确作为截断失败，审核拦截、网络完成异常、缺少正文、仅思考文本或多模态正文均失败。不提取 reasoning_content，也不保存外部报错、响应 id、任意附加字段或 cause。

正文必须直接解析成 JSON 对象：代码围栏、非法 JSON、数组/null/纯标量均失败，无剥离、补括号或第二次调用。本任务返回原正文字符串；Task6 仍必须调用 Task1 的 `normalizePlanContent` 校验完整日期、城市、来源和内容大小，再决定是否保存成功攻略。`{}` 虽语法合法，在后续领域验证中会失败，当前适配不冒充已生成合法行程。

`usage` 只保留 `prompt_tokens`、`completion_tokens`、`total_tokens` 中介于 0 与十亿之间的安全整数；无有效字段时返回 null。不采纳外部价格、错误文本或任意细节，不凭空生成费用。

## 本轮验证

五个平台各有独立模拟契约断言：目的地址、鉴权、8192 上限、非流式、手填模型不被替换、只有一次请求且无工具。共享真实安全传输层的模拟原生 HTTPS 401/429/400 也验证安全错误和零追加请求。另覆盖截断/工具输出/审核/空正文/非法 JSON、提示词资料边界、用量白名单与输入异步修改保护。未启动真实平台调用或网页联调；设置页和任务接线属于后续任务。
