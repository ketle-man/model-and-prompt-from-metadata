const _lang = (() => {
	const l = navigator.language ?? "";
	if (l.startsWith("ja")) return "ja";
	if (l.startsWith("zh")) return "zh";
	return "en";
})();

const _T = {
	en: {
		drop_main:      "Drop ComfyUI image / workflow JSON",
		drop_sub:       "Or click to select (PNG / JSON)",
		parsing:        "Parsing…",
		no_metadata:    "No metadata (use a ComfyUI-generated PNG or JSON)",
		no_ckpt_vae:    "No checkpoint / VAE info",
		no_info:        "No info",
		error_prefix:   "Error: ",
		file_too_large: "File too large (max 50 MB)",
		error_parse:    "Parse error (see console for details)",
		diff_detected:  "⚠ diffusion_models / text_encoders detected",
		diff_note:      "Cannot load with this node — drag the workflow directly into ComfyUI",
		diff_note_sd:   "Cannot load with this node — use UNETLoader + CLIPLoader in your ComfyUI workflow",
		none:           "None",
		ckpt_header:    (n, ins) => `Checkpoint  Detected: ${n}  Installed: ${ins}`,
		vae_header:     (n, ins) => `VAE  Detected: ${n}  Installed: ${ins}`,
		vae_no_loader:  "VAE  (no VAELoader in workflow)",
		label_positive: "Positive",
		label_negative: "Negative",
		preview_pos:    "▼ Positive Preview",
		preview_neg:    "▼ Negative Preview",
		prompt_fallback: (lbl, n) => `${lbl}  ${n} item(s) (unclassified — select manually)`,
		prompt_header:   (lbl, n) => `${lbl}  ${n} item(s)`,
	},
	zh: {
		drop_main:      "拖放 ComfyUI 图像 / 工作流 JSON",
		drop_sub:       "或点击选择 (PNG / JSON)",
		parsing:        "解析中…",
		no_metadata:    "无元数据（请使用 ComfyUI 生成的 PNG 或 JSON）",
		no_ckpt_vae:    "未找到 Checkpoint / VAE 信息",
		no_info:        "无信息",
		error_prefix:   "错误：",
		file_too_large: "文件过大（最大 50 MB）",
		error_parse:    "解析错误（详情请查看控制台）",
		diff_detected:  "⚠ 检测到 diffusion_models / text_encoders",
		diff_note:      "此节点无法加载 — 请将工作流直接拖入 ComfyUI 使用",
		diff_note_sd:   "此节点无法加载 — 请在 ComfyUI 工作流中使用 UNETLoader + CLIPLoader",
		none:           "无",
		ckpt_header:    (n, ins) => `Checkpoint  检测到: ${n}  已安装: ${ins}`,
		vae_header:     (n, ins) => `VAE  检测到: ${n}  已安装: ${ins}`,
		vae_no_loader:  "VAE（工作流中无 VAELoader）",
		label_positive: "Positive",
		label_negative: "Negative",
		preview_pos:    "▼ 正向提示词预览",
		preview_neg:    "▼ 负向提示词预览",
		prompt_fallback: (lbl, n) => `${lbl}  ${n} 个（未分类 — 请手动选择）`,
		prompt_header:   (lbl, n) => `${lbl}  ${n} 个`,
	},
	ja: {
		drop_main:      "ComfyUI 画像 / ワークフローJSONをドロップ",
		drop_sub:       "またはクリックして選択 (PNG / JSON)",
		parsing:        "解析中…",
		no_metadata:    "メタデータなし (ComfyUI生成PNGまたはJSONを使用してください)",
		no_ckpt_vae:    "チェックポイント・VAE情報なし",
		no_info:        "情報なし",
		error_prefix:   "エラー: ",
		file_too_large: "ファイルが大きすぎます（最大 50 MB）",
		error_parse:    "解析エラー（詳細はコンソールを参照）",
		diff_detected:  "⚠ diffusion_models / text_encoders を検出",
		diff_note:      "このノードでは読込めません — ワークフローを ComfyUI に直接ドラッグして使用してください",
		diff_note_sd:   "このノードでは読込めません — ComfyUI ワークフロー内で UNETLoader + CLIPLoader を使用してください",
		none:           "なし",
		ckpt_header:    (n, ins) => `Checkpoint  検出: ${n}件　インストール済み: ${ins}件`,
		vae_header:     (n, ins) => `VAE  検出: ${n}件　インストール済み: ${ins}件`,
		vae_no_loader:  "VAE  (ワークフロー内に VAELoader なし)",
		label_positive: "Positive",
		label_negative: "Negative",
		preview_pos:    "▼ ポジティブ プレビュー",
		preview_neg:    "▼ ネガティブ プレビュー",
		prompt_fallback: (lbl, n) => `${lbl}  ${n}件 (未分類 — 手動で選択してください)`,
		prompt_header:   (lbl, n) => `${lbl}  ${n}件`,
	},
};

export function t(key, ...args) {
	const val = _T[_lang]?.[key] ?? _T.en[key];
	return typeof val === "function" ? val(...args) : (val ?? key);
}

// Python側のwidget内部値（vae_name）— 既存ワークフローとの互換性のため変更しない
export const VAE_NONE_VALUE = "なし";
