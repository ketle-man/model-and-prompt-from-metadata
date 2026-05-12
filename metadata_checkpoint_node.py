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

    if vae_name and vae_name != "なし":
        vae_path = folder_paths.get_full_path("vae", vae_name)
        sd = comfy.utils.load_torch_file(vae_path)
        vae = comfy.sd.VAE(sd=sd)

    return model, clip, vae


def _encode(clip, text):
    tokens = clip.tokenize(text)
    cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
    return [[cond, {"pooled_output": pooled}]]


class ImageMetadataCheckpointLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"), {
                    "tooltip": "Checkpoint model to load. Drop a ComfyUI PNG/JSON above to auto-select.",
                }),
                "vae_name": (["なし"] + folder_paths.get_filename_list("vae"), {
                    "tooltip": "VAE to use. Select 'なし' to use the VAE embedded in the checkpoint.",
                }),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "load_checkpoint"
    CATEGORY = "loaders"
    DESCRIPTION = "Loads a checkpoint model and optional VAE. Drop a ComfyUI-generated PNG or workflow JSON onto the node to auto-detect and select the model from its metadata."

    def load_checkpoint(self, ckpt_name, vae_name):
        return _load_ckpt(ckpt_name, vae_name)


class ImageMetadataPromptLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"), {
                    "tooltip": "Checkpoint model to load. Drop a ComfyUI PNG/JSON above to auto-select.",
                }),
                "vae_name": (["なし"] + folder_paths.get_filename_list("vae"), {
                    "tooltip": "VAE to use. Select 'なし' to use the VAE embedded in the checkpoint.",
                }),
                "positive_text": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Positive prompt text. Set automatically when you click a detected prompt above.",
                }),
                "negative_text": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Negative prompt text. Set automatically when you click a detected prompt above.",
                }),
            }
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "CONDITIONING", "CONDITIONING",
        "STRING", "STRING",
    )
    RETURN_NAMES = (
        "model", "clip", "vae",
        "positive", "negative",
        "positive_text", "negative_text",
    )
    FUNCTION = "load"
    CATEGORY = "loaders"
    DESCRIPTION = "Loads a checkpoint model, VAE, and encodes positive/negative prompts. Drop a ComfyUI-generated PNG or workflow JSON onto the node to auto-detect the model and prompts from its metadata."

    def load(self, ckpt_name, vae_name, positive_text, negative_text):
        model, clip, vae = _load_ckpt(ckpt_name, vae_name)
        return (
            model, clip, vae,
            _encode(clip, positive_text),
            _encode(clip, negative_text),
            positive_text,
            negative_text,
        )


NODE_CLASS_MAPPINGS = {
    "ImageMetadataCheckpointLoader": ImageMetadataCheckpointLoader,
    "ImageMetadataPromptLoader": ImageMetadataPromptLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageMetadataCheckpointLoader": "Model from Metadata",
    "ImageMetadataPromptLoader": "Model-Prompt from Metadata",
}
