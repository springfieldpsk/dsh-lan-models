# dsh-lan-models

[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 插件：**局域网本地模型联动手套**。

一台机器上的 dsh 会话，可以直接使用整个局域网的本地模型：

- 🔍 **发现**——扫描网段，识别 ComfyUI / oMLX / vLLM / Ollama / LM Studio / llama.cpp 等服务，报告地址、软件版本、模型清单、GPU 显存、队列状态
- 💬 **LLM 路由**——`lan_chat` 把补全请求发给局域网内任意 OpenAI 兼容本地 LLM（支持 thinking 模型的 reasoning 分离）
- 🖼️ **生图 / 🎬 生视频**——封装 ComfyUI 队列 API：内置通用工作流 + 自定义工作流目录（把你的 H3 / Qwen-Image / MOSS-Image 工作流丢进去即可），参数自动填充、模型自动匹配、产物自动落盘
- 📖 **prompt 指南**——内置 `lan-models` skill，教 agent 按模型家族写生图/生视频提示词

适配 dsh：`>=0.2.2-rc.1 <0.3.0`（developer preview，API 变动时需跟进）。

## 安装

```sh
# 方式一：本地目录
dsh plugin --profile web add ~/dsh-lan-models

# 方式二：git（pin commit 更稳）
dsh plugin --profile web add github:<you>/dsh-lan-models

# 方式三：npm 发布后
dsh plugin --profile web add dsh-lan-models
```

验证：

```sh
dsh --profile web --dump-config | grep -A2 'dsh-lan-models'
```

> git/本地目录安装会触发 `prepare` 构建；若 profile 的 pnpm 拦截构建脚本，在 profile 的
> `pnpm-workspace.yaml` 加 `allowBuilds: { dsh-lan-models: true }`。

## 工具面（模型可调用）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `lan_scan` | 扫描局域网，返回全部服务与状态 | `refresh`、`cidr` |
| `lan_model_status` | 单服务详情；ComfyUI 返回完整模型清单（checkpoint/unet/vae/clip/lora） | `node`（IP/URL/alias） |
| `lan_chat` | 补全请求路由到局域网 LLM | `prompt` 或 `messages`、`model`（模糊匹配）、`node`、`maxTokens`、`temperature` |
| `lan_generate_image` | ComfyUI 生图 | `prompt`、`negative`、`width/height/steps/cfg/seed`、`model`、`node`、`workflow` |
| `lan_generate_video` | ComfyUI 生视频（走自定义工作流） | 同上 + `frames`、`fps` |

斜杠命令：`/lan`（输入 `refresh` 强制重扫）— 人类视角的服务总览。

模型选择策略：`node` 不填时自动优先**局域网机器**（推理主力一般在别的机器上）；`model` 支持模糊匹配（`qwen` → `Qwen3.8-27B-...`）。

## 配置

profile 的 `cordis.patch.yml` 中给插件加 `config:`（Schemastery 校验）：

```yaml
- id: lan-models
  name: dsh-lan-models
  config:
    extraCidrs:
      - 192.168.1.0/24
    staticHosts:
      - url: http://127.0.0.1:8000
        alias: mac-llm        # oMLX 绑 127.0.0.1，扫描发现不了，必须静态声明
      - url: http://192.168.1.100:8188
        alias: mac-comfy
    ports: [8000, 8080, 8188, 11434, 1234, 7860, 9997]
    imageTimeoutMinutes: 10
    videoTimeoutMinutes: 60
```

全部选项与默认值见 `src/config.ts`。要点：

- **`staticHosts`** 用于回环绑定（oMLX 默认 127.0.0.1）或固定机器；默认含 `http://127.0.0.1:8000`
- **产物目录**默认 `$DSH_HOME/lan-models/outputs/<时间戳>-<workflow>/`
- 扫描并发/超时可调；/24 全网扫描默认配置下约 5–15s

## 自定义工作流（生视频/专用生图线的正道）

1. 在 ComfyUI 里调好工作流，**Export (API Format)** 导出 JSON
2. 放入 `$DSH_HOME/lan-models/workflows/`，文件名 = 工作流名（`txt2video.json`、`h3.json`…）
3. 生成时 `workflow: "h3"` 调用；同名文件覆盖内置模板

参数填充按节点类型自动进行，无需改 JSON：

| 节点 | 自动填充 |
|---|---|
| `CLIPTextEncode`（按 KSampler 正负接线识别） | `prompt` / `negative` |
| `KSampler` 等 sampler | `steps` / `cfg` / `seed`（不填随机并注明） |
| `EmptyLatent*` / `EmptySD3LatentImage` | `width` / `height` / `batch` / `frames` |
| `CheckpointLoaderSimple` / `UNETLoader` / `CLIPLoader` / `VAELoader` | 模型名（显式 > 模糊匹配 > 自动选首个可用） |
| `SaveImage` / `VHS_VideoCombine` | `filename_prefix` / `fps` |

`examples/qwen-image.json` 是一个可直接复制使用的 Qwen-Image 工作流（unet + qwen3vl clip + vae 分离加载，`ModelSamplingAuraFlow shift=3.11, cfg=2.5`）。

内置模板：`txt2img`（checkpoint 式，SD/SDXL/Flux checkpoint）、`txt2img-unet`（unet+clip+vae 分离式；节点无 checkpoint 时自动回退到它）。

## 开发

```sh
npm install --legacy-peer-deps   # peer 由 dsh profile 运行时提供
npm run build                    # tsc -> dist/
npm test                         # 单测（含 mock ComfyUI 全链路）
node test/e2e-real.mjs           # 真实环境：lan_scan + lan_chat（本机需有服务在跑）
node test/e2e-gen.mjs            # 真实环境：完整生图链路
```

结构：

```
src/
├── index.ts          # apply()：装配 tools/commands/skills
├── config.ts         # Schemastery 配置
├── discovery/        # 网段探测(net) + HTTP 指纹(probes) + 缓存与选择器(registry)
├── llm/openai.ts     # OpenAI 兼容 chat 客户端（reasoning_content 分离）
├── comfyui/          # 队列 API client / 工作流注册 / 参数填充 / 产物落盘
├── tools.ts          # 5 个 defineTool
├── commands.ts       # /lan
├── skills.ts         # lan-models skill（prompt 指南）
└── format.ts         # markdown 渲染
```

零运行时依赖（HTTP 用全局 `fetch`，TCP 用 `node:net`）；peer 依赖全部由 dsh profile 的 dsh-base 提供。

## 已知边界

- OpenAI 兼容服务若只绑定 `127.0.0.1`（如 oMLX 默认），其他机器不可达——扫描结果会标注 `loopback: 仅本机可用`，需改绑定才能跨机
- 视频没有内置通用模板（机型差异太大），请用自定义工作流目录
- `dsh` 处于 developer preview，本插件按 `0.2.2-rc.1` 的 API 编写，`engines.dsh` 已 pin

## License

MIT
