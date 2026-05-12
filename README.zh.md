# Model and Prompt from Metadata

**语言：** [English](README.md) | [日本語](README.ja.md)

---

这是一个 ComfyUI 自定义节点，旨在快速复用使用 **SD1.5 / SDXL / Illustrious** 模型生成的图像元数据，从而加速整体工作流程。

只需将 PNG 图像或工作流 JSON 拖放到节点上，即可从嵌入的元数据中提取 Checkpoint、VAE 和提示词，并自动填入节点。可以立即重现过去的生成设置，缩短反复试验的周期。

除 ComfyUI 生成的图像外，还支持由 **Stable Diffusion WebUI / SD Forge neo / Fooocus** 生成的图像，以及 **ComfyUI-Custom-Scripts 的 Workflow Image**。

### 不支持的模型

**Flux、QWEN、zImage** 等基于 UNet 架构的模型不在支持范围内。这些模型结构不同，不适合通过单独替换 Checkpoint 来管理画风，使用本节点并不能提高效率。如果拖入包含这些模型的文件，节点将显示模型文件名，并提示将工作流 JSON 直接拖入 ComfyUI 使用。

> **界面语言：** 根据浏览器的语言设置自动切换为中文 / 英语 / 日语。

---

## 截图

![节点截图](docs/screenshot1.png)

*左：Model-Prompt from Metadata — 检测到 Checkpoint、VAE 和提示词并自动选中。右：Model from Metadata — 检测到基于 UNet 的模型（QWEN），提示直接使用工作流。*

---

## 节点列表

### Model from Metadata (`ImageMetadataCheckpointLoader`)

**分类：** `loaders`

拖入 PNG 或 JSON 文件，加载 Checkpoint 和 VAE。

**输出**

| 名称 | 类型 | 说明 |
|---|---|---|
| model | MODEL | 已加载的模型 |
| clip | CLIP | CLIP |
| vae | VAE | VAE（选择"无"时使用 Checkpoint 内置 VAE）|

---

### Model-Prompt from Metadata (`ImageMetadataPromptLoader`)

**分类：** `loaders`

除 Checkpoint 和 VAE 外，还可提取并编码正向 / 负向提示词。

**输出**

| 名称 | 类型 | 说明 |
|---|---|---|
| model | MODEL | 已加载的模型 |
| clip | CLIP | CLIP |
| vae | VAE | VAE |
| positive | CONDITIONING | 正向条件 |
| negative | CONDITIONING | 负向条件 |
| positive_text | STRING | 正向提示词（原始文本）|
| negative_text | STRING | 负向提示词（原始文本）|

---

## 使用方法

1. 将 PNG 图像或工作流 JSON 拖放到节点上的拖放区（或点击选择文件）。
2. 元数据解析完成后，将显示检测到的 Checkpoint、VAE 和提示词列表。
3. 点击列表中的项目进行选择。已安装的模型显示 ✓，未安装的显示 ✗。
4. **若仅检测到 1 个 Checkpoint 且已安装，则自动选中。**
5. **若仅检测到 1 个 VAE 且已安装，也会自动选中。** 若工作流中没有 VAELoader，则自动选择"无"。如需手动修改，请从列表中选择。
6. 点击提示词可选中，并在下方预览区查看完整内容。

### 拖入 UNet 系模型文件时

如[上文](#不支持的模型)所述，拖入包含 UNETLoader + CLIPLoader 配置的工作流或 SD Forge neo Flux / UNet 图像时，节点将显示模型文件名，并提示将工作流 JSON 直接拖入 ComfyUI 使用。

---

## 支持的文件格式

| 来源 | 格式 | 备注 |
|---|---|---|
| ComfyUI | PNG（`prompt` 数据块）| 支持 API 格式和 LiteGraph 格式 |
| ComfyUI | JSON 工作流 | 支持 API 格式和 LiteGraph 格式 |
| ComfyUI | 包含本节点的工作流 JSON / PNG | 恢复已保存的选择（ckpt、VAE、提示词）|
| ComfyUI-Custom-Scripts | Workflow Image PNG | 从 IEND 后的 `workflow` 数据块提取 LiteGraph 格式 |
| Workflow Studio | JSON 工作流 / PNG | 从 `WFS_PromptText` 提示词预设节点提取提示词 |
| SD WebUI / SD Forge neo | PNG（`parameters` 数据块）| 支持 Checkpoint 和 UNet 两种配置 |
| Fooocus | PNG（`parameters` JSON 数据块）| 提取 `base_model` / `vae` / 提示词 |

---

## 安装

```
ComfyUI/
└── custom_nodes/
    └── model-and-prompt-from-metadata/   ← 将本仓库放置于此
        ├── __init__.py
        ├── metadata_checkpoint_node.py
        └── js/
            ├── i18n.js
            ├── metadata_checkpoint.js
            ├── metadata_prompt.js
            └── workflow_utils.js
```

重启 ComfyUI 后将自动加载。

---

## 文件结构

```
model-and-prompt-from-metadata/
├── __init__.py                   # 入口点 / WEB_DIRECTORY 设置
├── metadata_checkpoint_node.py   # Python 节点定义（2 个类）
└── js/
    ├── i18n.js                   # 多语言支持（en / zh / ja 自动检测）
    ├── workflow_utils.js         # PNG 解析 / 元数据提取工具
    ├── metadata_checkpoint.js    # CheckpointLoader UI 扩展
    └── metadata_prompt.js        # PromptLoader UI 扩展
```
