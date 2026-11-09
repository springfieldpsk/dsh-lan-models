/** The `lan-models` skill: how to use the LAN model mesh and how to write image/video prompts. */
import { resolveWorkflowsDir } from './config.js';
export function registerSkills(skills, config) {
    if (!skills)
        return;
    const workflowsDir = resolveWorkflowsDir(config);
    skills.register({
        name: 'lan-models',
        description: '局域网本地模型联动手册：lan_scan/lan_chat/lan_generate_image/lan_generate_video 的使用时机与生图/生视频 prompt 写法',
        whenToUse: '用户要发现/查询局域网内机器上的模型、用本地 LLM 处理子任务、或在局域网 ComfyUI 上生图生视频时使用。调用生成工具前先读本 skill 的 prompt 指南。',
        content: `# 局域网本地模型联动（lan-models）

## 工作流

1. **看拓扑**：先 \`lan_scan\`（缓存约 ${config.cacheTtlSeconds}s；传 \`refresh: true\` 强制重扫）。每个服务返回地址、软件、模型、GPU 显存、队列。
2. **选细节**：需要完整模型清单（选 checkpoint/VAE/LoRA）时用 \`lan_model_status\` 查具体节点。
3. **文本任务**：翻译、摘要、改写、草稿等子任务用 \`lan_chat\` 发给本地 LLM（指定 model 可模糊匹配，如 "qwen"）。
4. **生图**：\`lan_generate_image\`；**生视频**：\`lan_generate_video\`。node 不填时自动优先局域网机器（显存大的那台通常在外面）。

注意：loopback（127.0.0.1）服务只有本机能用；要让其他机器调用 oMLX 之类，需把服务绑定到 0.0.0.0 后重启。

## 生图 prompt 指南

结构（按需取舍，自然语言或 tag 风格均可）：
\`主体（谁/什么，带细节）→ 动作/姿态 → 环境/光线 → 构图/镜头 → 艺术风格 → 质量词\`

- **Qwen-Image / Qwen2-VL 系**：中英双语皆可，擅长长自然语言与画面内文字（把要写的字用引号给出）。
- **SD1.5/SDXL**：tag 风格更稳（\`masterpiece, best quality, 1girl, …\`），负面词给 \`worst quality, lowres, watermark, text\`。
- **Flux / 通用 diffusion 模型**：自然语言描述整幅画面，cfg 通常 2.5–4.5（低 CFG），steps 20–30。
- 分辨率跟模型原生走：SDXL/Qwen-Image 1024–1328，SD1.5 512–768；放大约 1.4 倍比拉大分辨率更保构图。
- 复现同一画面：固定 seed 后只微调 prompt。

## 生视频 prompt 指南

一句话公式：\`主体 + 外观细节 + 动作（一个连续动作，别贪多） + 镜头运动（push in / pan left / orbit / static） + 风格氛围\`

- 一次只描述 1–2 个动作，多动作分多次生成再剪。
- 帧数 = 时长 × fps：如 5s@24fps → frames 120。分辨率用模型原生档（常见 480p/720p），放大交给后续节点。
- 视频工作流是机型相关的：把 ComfyUI 里 "Save (API Format)" 导出的 JSON 放进 \`${workflowsDir}\`，文件名即工作流名（如 \`txt2video.json\`、\`h3.json\`），生成时用 \`workflow: "h3"\` 调用。
- 常用负面：\`blurry, low quality, flickering, distorted, watermark\`

## 自定义工作流

目录 \`${workflowsDir}\` 中每个 JSON 是一个工作流（ComfyUI API 格式）。参数填充按节点类型自动进行：CLIPTextEncode←prompt/negative、KSampler←steps/cfg/seed、EmptyLatent*←宽高/帧数、Save*←文件名前缀；模型名自动匹配节点上实际可用的。同名文件覆盖内置模板。
`,
    });
}
