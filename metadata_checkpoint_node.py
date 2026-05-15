import json
import folder_paths
import comfy.sd
import comfy.utils


def _load_ckpt(ckpt_name, vae_name):
    ckpt_path = folder_paths.get_full_path("checkpoints", ckpt_name)
    out = comfy.sd.load_checkpoint_guess_config(
        ckpt_path,
        output_vae=True,
        output_clip=True,
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
    )
    model, clip, vae = out[0], out[1], out[2]

    if vae_name and vae_name != "None":
        vae_path = folder_paths.get_full_path("vae", vae_name)
        sd = comfy.utils.load_torch_file(vae_path)
        vae = comfy.sd.VAE(sd=sd)

    return model, clip, vae


def _encode(clip, text):
    tokens = clip.tokenize(text)
    cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
    return [[cond, {"pooled_output": pooled}]]


def _parse_metadata(metadata_json):
    try:
        return json.loads(metadata_json) if metadata_json else {}
    except Exception:
        return {}


class ImageMetadataCheckpointLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"), {
                    "tooltip": "Checkpoint model to load. Drop a ComfyUI PNG/JSON above to auto-select.",
                }),
                "vae_name": (["None"] + folder_paths.get_filename_list("vae"), {
                    "tooltip": "VAE to use. Select 'None' to use the VAE embedded in the checkpoint.",
                }),
                "_metadata_json": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", "METADATA")
    RETURN_NAMES = ("model", "clip", "vae", "metadata")
    FUNCTION = "load_checkpoint"
    CATEGORY = "loaders"
    DESCRIPTION = "Loads a checkpoint model and optional VAE. Drop a ComfyUI-generated PNG or workflow JSON onto the node to auto-detect and select the model from its metadata."

    def load_checkpoint(self, ckpt_name, vae_name, _metadata_json=""):
        model, clip, vae = _load_ckpt(ckpt_name, vae_name)
        return (model, clip, vae, _parse_metadata(_metadata_json))


class ImageMetadataPromptLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"), {
                    "tooltip": "Checkpoint model to load. Drop a ComfyUI PNG/JSON above to auto-select.",
                }),
                "vae_name": (["None"] + folder_paths.get_filename_list("vae"), {
                    "tooltip": "VAE to use. Select 'None' to use the VAE embedded in the checkpoint.",
                }),
                "positive_text": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Positive prompt text. Set automatically when you click a detected prompt above.",
                }),
                "negative_text": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Negative prompt text. Set automatically when you click a detected prompt above.",
                }),
                "_metadata_json": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "CONDITIONING", "CONDITIONING",
        "STRING", "STRING",
        "METADATA",
    )
    RETURN_NAMES = (
        "model", "clip", "vae",
        "positive", "negative",
        "positive_text", "negative_text",
        "metadata",
    )
    FUNCTION = "load"
    CATEGORY = "loaders"
    DESCRIPTION = "Loads a checkpoint model, VAE, and encodes positive/negative prompts. Drop a ComfyUI-generated PNG or workflow JSON onto the node to auto-detect the model and prompts from its metadata."

    def load(self, ckpt_name, vae_name, positive_text, negative_text, _metadata_json=""):
        model, clip, vae = _load_ckpt(ckpt_name, vae_name)
        return (
            model, clip, vae,
            _encode(clip, positive_text),
            _encode(clip, negative_text),
            positive_text,
            negative_text,
            _parse_metadata(_metadata_json),
        )


class ImageMetadataLoRALoader:
    @classmethod
    def INPUT_TYPES(s):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        slot = {"tooltip": "Select 'None' to bypass this slot."}
        strength = {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora_1": (lora_list, slot),
                "strength_model_1": ("FLOAT", strength),
                "strength_clip_1": ("FLOAT", strength),
                "lora_2": (lora_list, slot),
                "strength_model_2": ("FLOAT", strength),
                "strength_clip_2": ("FLOAT", strength),
                "lora_3": (lora_list, slot),
                "strength_model_3": ("FLOAT", strength),
                "strength_clip_3": ("FLOAT", strength),
            },
            "optional": {
                "metadata": ("METADATA",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "load_loras"
    CATEGORY = "loaders"
    DESCRIPTION = (
        "Applies up to 3 LoRA models sequentially. "
        "Select 'None' for any slot to bypass it. "
        "Drop a ComfyUI-generated PNG or workflow JSON onto the node to "
        "auto-detect and assign LoRA models from its metadata."
    )

    def load_loras(
        self, model, clip,
        lora_1, strength_model_1, strength_clip_1,
        lora_2, strength_model_2, strength_clip_2,
        lora_3, strength_model_3, strength_clip_3,
        metadata=None,
    ):
        slots = [
            (lora_1, strength_model_1, strength_clip_1),
            (lora_2, strength_model_2, strength_clip_2),
            (lora_3, strength_model_3, strength_clip_3),
        ]
        for lora_name, sm, sc in slots:
            if lora_name == "None":
                continue
            lora_path = folder_paths.get_full_path("loras", lora_name)
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model, clip = comfy.sd.load_lora_for_models(model, clip, lora, sm, sc)
        return (model, clip)


class CLIPTextEncodeEditPlus:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "clip":      ("CLIP",),
                "text":      ("STRING", {"forceInput": True}),
                "text_edit": ("STRING", {"default": ""}),
                "mode":      (["RAW", "EDIT"],),
            }
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "encode"
    CATEGORY = "conditioning"
    DESCRIPTION = (
        "Encodes a prompt with CLIP and outputs CONDITIONING. "
        "RAW mode uses the incoming text as-is; EDIT mode uses the manually edited version."
    )

    def encode(self, clip, text, text_edit, mode):
        selected = text if mode == "RAW" else text_edit
        return (_encode(clip, selected),)


NODE_CLASS_MAPPINGS = {
    "ImageMetadataCheckpointLoader": ImageMetadataCheckpointLoader,
    "ImageMetadataPromptLoader": ImageMetadataPromptLoader,
    "ImageMetadataLoRALoader": ImageMetadataLoRALoader,
    "CLIPTextEncodeEditPlus": CLIPTextEncodeEditPlus,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageMetadataCheckpointLoader": "Model from Metadata",
    "ImageMetadataPromptLoader": "Model-Prompt from Metadata",
    "ImageMetadataLoRALoader": "LoRA from Metadata",
    "CLIPTextEncodeEditPlus": "CLIP Text Encode edit+",
}
