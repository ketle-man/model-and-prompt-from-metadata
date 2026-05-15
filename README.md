# Model and Prompt from Metadata

**Language:** [日本語](README.ja.md) | [中文](README.zh.md)

---

A ComfyUI custom node designed to quickly reuse metadata from images generated with **SD1.5 / SDXL / Illustrious** models, accelerating your overall workflow.

Simply drop a PNG or WebP image, or a workflow JSON, onto the node to extract the checkpoint, VAE, and prompts from the embedded metadata and apply them automatically. Instantly reproduce past generation settings and shorten your trial-and-error cycle.

Also supports images generated with **Stable Diffusion WebUI / SD Forge neo / Fooocus**, and **ComfyUI-Custom-Scripts Workflow Images**.

### Out-of-Scope Models

UNet-based models such as **Flux, QWEN, and zImage** are out of scope. These models have a different architecture and are not suited for the workflow style of managing aesthetics by swapping a single checkpoint, so using this node with them would not improve efficiency. If you drop a file containing these models, a message will be shown displaying the model name and prompting you to drag the workflow JSON directly into ComfyUI.

> **UI language:** Automatically switches between English / Japanese / Chinese based on your browser's language settings.

---

## Screenshot

![All four nodes in default state](docs/Screenshot.png)

*All four nodes: LoRA from Metadata, Model-Prompt from Metadata, Model from Metadata, and CLIP Text Encode edit+.*

![Nodes with metadata loaded](docs/Screenshot_sample.png)

*Left: LoRA from Metadata — LoRA detected and auto-assigned to slot 1. Center: Model-Prompt from Metadata — checkpoint, VAE, and prompt auto-selected. Right: Model from Metadata — UNet-based model (Flux) detected, prompting use of the workflow directly.*

---

## Nodes

### Model from Metadata (`ImageMetadataCheckpointLoader`)

**Category:** `loaders`

Drop a PNG, WebP, or JSON to load the checkpoint and VAE.

**Outputs**

| Name | Type | Description |
|---|---|---|
| model | MODEL | Loaded model |
| clip | CLIP | CLIP |
| vae | VAE | VAE (uses checkpoint's built-in VAE when "None" is selected) |

---

### Model-Prompt from Metadata (`ImageMetadataPromptLoader`)

**Category:** `loaders`

In addition to the checkpoint and VAE, also extracts and encodes positive/negative prompts. Accepts PNG, WebP, and JSON.

**Outputs**

| Name | Type | Description |
|---|---|---|
| model | MODEL | Loaded model |
| clip | CLIP | CLIP |
| vae | VAE | VAE |
| positive | CONDITIONING | Positive conditioning |
| negative | CONDITIONING | Negative conditioning |
| positive_text | STRING | Positive prompt (raw text) |
| negative_text | STRING | Negative prompt (raw text) |

---

### LoRA from Metadata (`ImageMetadataLoRALoader`)

**Category:** `loaders`

Applies up to 3 LoRA models sequentially. Drop a PNG, WebP, or JSON to auto-detect and assign LoRAs from metadata.

**Inputs**

| Name | Type | Description |
|---|---|---|
| model | MODEL | Model |
| clip | CLIP | CLIP |
| metadata | METADATA | (Optional) Metadata from an upstream node |

**Outputs**

| Name | Type | Description |
|---|---|---|
| model | MODEL | Model with LoRAs applied |
| clip | CLIP | CLIP with LoRAs applied |

---

### CLIP Text Encode edit+ (`CLIPTextEncodeEditPlus`)

**Category:** `conditioning`

A CLIP encoder that lets you choose between using the received prompt as-is (RAW) or a manually edited version (EDIT). Use two instances — one for positive, one for negative.

- **EDIT textarea**: Pre-filled with the received text on first connection; freely editable
- **RAW / EDIT button**: Selects which text is used for CONDITIONING output

**Inputs**

| Name | Type | Description |
|---|---|---|
| clip | CLIP | CLIP |
| text | STRING | Prompt to encode (connect a STRING output from another node) |

**Outputs**

| Name | Type | Description |
|---|---|---|
| conditioning | CONDITIONING | Encoded conditioning (uses RAW or EDIT text) |

---

## Usage

### Model-Prompt from Metadata / Model from Metadata

1. Drag and drop a PNG or WebP image, or a workflow JSON, onto the drop zone on the node (or click to open a file dialog).
2. The metadata is parsed and a list of detected checkpoints, VAEs, and prompts is displayed.
3. Click an item in the list to select it. ✓ indicates an installed model; ✗ indicates one that is not installed.
4. **If exactly one checkpoint is detected and installed, it is auto-selected.**
5. **If exactly one VAE is detected and installed, it is also auto-selected.** If the workflow contains no VAELoader, "None" is auto-selected. You can change the selection manually from the list.
6. **If exactly one prompt is detected, it is auto-selected.** If multiple prompts are found, click one to select it and preview the full text below.

### CLIP Text Encode edit+

1. Connect `positive_text` / `negative_text` outputs from **Model-Prompt from Metadata** to the `text` input of each node.
2. On connection, the EDIT textarea is pre-filled with the same content.
3. Edit the textarea as needed, then use the RAW / EDIT button to choose which text to output.

### When a UNet-based model file is dropped

As described [above](#out-of-scope-models), dropping a workflow or image that contains a UNETLoader + CLIPLoader configuration, or a SD Forge neo Flux / UNet image, will display the model filename and prompt you to drag the workflow JSON directly into ComfyUI.

---

## Supported File Formats

| Source | Format | Notes |
|---|---|---|
| ComfyUI | PNG (`prompt` chunk) | Supports both API format and LiteGraph format |
| ComfyUI | WebP (EXIF `workflow:` / `prompt:` entry) | Extracts LiteGraph or API format from the EXIF chunk |
| ComfyUI | JSON workflow | Supports both API format and LiteGraph format |
| ComfyUI | Workflow JSON / PNG containing this node | Restores saved selections (ckpt, VAE, prompts) |
| ComfyUI-Custom-Scripts | Workflow Image PNG | Extracts LiteGraph format from `workflow` chunk after IEND |
| Workflow Studio | JSON workflow / PNG | Extracts prompts from `WFS_PromptText` prompt preset nodes |
| SD WebUI / SD Forge neo | PNG (`parameters` chunk) | Supports both Checkpoint and UNet configurations |
| Fooocus | PNG (`parameters` JSON chunk) | Extracts `base_model` / `vae` / prompts |

### Supported Custom Nodes

| Node | Description |
|---|---|
| SDXLPromptStyler / SDXLPromptStylerAll | Prompts are automatically extracted |
| Lora Loader (LoraManager) | LoRAs are auto-detected and assigned (entries with `active: false` are skipped) |

---

## Installation

```
ComfyUI/
└── custom_nodes/
    └── model-and-prompt-from-metadata/   ← Place this repository here
        ├── __init__.py
        ├── metadata_checkpoint_node.py
        └── js/
            ├── i18n.js
            ├── metadata_checkpoint.js
            ├── metadata_prompt.js
            ├── metadata_lora.js
            ├── clip_text_encode_edit_plus.js
            └── workflow_utils.js
```

Restart ComfyUI and the node will be loaded automatically.

---

## File Structure

```
model-and-prompt-from-metadata/
├── __init__.py                        # Entry point / WEB_DIRECTORY setting
├── metadata_checkpoint_node.py        # Python node definitions (4 classes)
└── js/
    ├── i18n.js                        # Multilingual support (en / zh / ja auto-detect)
    ├── workflow_utils.js              # PNG parsing / metadata extraction utilities
    ├── metadata_checkpoint.js         # CheckpointLoader UI extension
    ├── metadata_prompt.js             # PromptLoader UI extension
    ├── metadata_lora.js               # LoRALoader UI extension
    └── clip_text_encode_edit_plus.js  # CLIP Text Encode edit+ UI
```
