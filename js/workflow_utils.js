// ---- PNG メタデータ解析 ----

function findNull(arr, start = 0) {
	for (let i = start; i < arr.length; i++) {
		if (arr[i] === 0) return i;
	}
	return -1;
}

function parseTEXtChunk(data, latin1) {
	const nullPos = findNull(data);
	if (nullPos === -1) return null;
	return {
		keyword: latin1.decode(data.slice(0, nullPos)),
		text: latin1.decode(data.slice(nullPos + 1)),
	};
}

function parseITXtChunk(data, latin1, utf8) {
	const nullPos = findNull(data);
	if (nullPos === -1) return null;
	const keyword = latin1.decode(data.slice(0, nullPos));

	let pos = nullPos + 3; // \0 + compFlag + compMethod
	pos = findNull(data, pos);
	if (pos === -1) return null;
	pos++;
	pos = findNull(data, pos);
	if (pos === -1) return null;
	pos++;

	return { keyword, text: utf8.decode(data.slice(pos)) };
}

async function parsePNGPromptText(file) {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < 8; i++) {
		if (bytes[i] !== PNG_SIG[i]) return null;
	}

	const view = new DataView(buffer);
	const latin1 = new TextDecoder("latin1");
	const utf8 = new TextDecoder("utf-8");
	let offset = 8;

	while (offset + 12 <= buffer.byteLength) {
		const length = view.getUint32(offset);
		if (offset + 12 + length > buffer.byteLength) break;

		const type = latin1.decode(bytes.slice(offset + 4, offset + 8));
		const data = bytes.slice(offset + 8, offset + 8 + length);

		if (type === "tEXt") {
			const chunk = parseTEXtChunk(data, latin1);
			if (chunk?.keyword === "prompt") return chunk.text;
		} else if (type === "iTXt") {
			const chunk = parseITXtChunk(data, latin1, utf8);
			if (chunk?.keyword === "prompt") return chunk.text;
		} else if (type === "IEND") {
			break;
		}

		offset += 12 + length;
	}
	return null;
}

// ---- ワークフロー取得（PNG / JSON → 解析済みオブジェクト） ----

export async function getParsedWorkflow(file) {
	const isJSON =
		file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
	const text = isJSON ? await file.text() : await parsePNGPromptText(file);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

// ---- カスタムノード定数 ----

export const MAX_FILE_SIZE = 50 * 1024 * 1024;

const METADATA_NODE_TYPES = new Set([
	"ImageMetadataCheckpointLoader",
	"ImageMetadataPromptLoader",
]);
// Python側の widget 内部値（vae_nameの「なし」= VAEなし）
const VAE_NONE = "なし";

// ---- 共通ヘルパー ----

export function collectUnique(arr) {
	const seen = new Set();
	const out = [];
	for (const v of arr) {
		if (v && typeof v === "string" && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
}

// ---- テキストエンコーダー系ノードかどうか判定 ----
function isTextEncoderNode(classType) {
	// CLIPTextEncode / CLIPTextEncodeSDXL / CLIPTextEncodeSDXLRefiner 等
	return classType === "CLIPTextEncode" ||
		classType.includes("TextEncode") ||
		classType.includes("TextEncoderSD");
}

// ---- サンプラー系ノードかどうか判定 ----
function isSamplerNode(classType) {
	return classType === "KSampler" ||
		classType === "KSamplerAdvanced" ||
		classType === "SamplerCustom" ||
		classType === "SamplerCustomAdvanced" ||
		classType.includes("KSampler") ||
		classType.includes("Sampler");
}

// ---- Checkpoint 抽出 ----

export function extractCheckpoints(workflow) {
	if (!workflow || typeof workflow !== "object") return [];
	if (Array.isArray(workflow.nodes)) {
		return collectUnique(
			workflow.nodes
				.filter((n) => {
					const type = n.type ?? "";
					return type.toLowerCase().includes("checkpoint") || METADATA_NODE_TYPES.has(type);
				})
				.map((n) => n.widgets_values?.[0])
		);
	}
	return collectUnique(
		Object.values(workflow)
			.filter((n) => {
				if (!n || typeof n !== "object") return false;
				const ct = n.class_type ?? "";
				return ct.toLowerCase().includes("checkpoint") || METADATA_NODE_TYPES.has(ct);
			})
			.map((n) => n.inputs?.ckpt_name)
	);
}

// ---- 全ノード収集（サブグラフを含む）----

function collectAllNodes(workflow) {
	if (!Array.isArray(workflow.nodes)) return [];
	const all = [...workflow.nodes];
	for (const sg of workflow.definitions?.subgraphs ?? []) {
		if (Array.isArray(sg.nodes)) all.push(...sg.nodes);
	}
	return all;
}

// ---- VAE 抽出 ----

export function extractVAEs(workflow) {
	if (!workflow || typeof workflow !== "object") return [];
	if (Array.isArray(workflow.nodes)) {
		return collectUnique(
			workflow.nodes.flatMap((n) => {
				if (n.type === "VAELoader") return [n.widgets_values?.[0]];
				if (METADATA_NODE_TYPES.has(n.type ?? "")) {
					const v = n.widgets_values?.[1];
					return v && v !== VAE_NONE ? [v] : [];
				}
				return [];
			})
		);
	}
	return collectUnique(
		Object.values(workflow).flatMap((n) => {
			if (!n || typeof n !== "object") return [];
			if (n.class_type === "VAELoader") return [n.inputs?.vae_name];
			if (METADATA_NODE_TYPES.has(n.class_type ?? "")) {
				const v = n.inputs?.vae_name;
				return v && v !== VAE_NONE ? [v] : [];
			}
			return [];
		})
	);
}

// ---- diffusion_models 抽出 (UNETLoader) ----

export function extractDiffusionModels(workflow) {
	if (!workflow || typeof workflow !== "object") return [];
	if (Array.isArray(workflow.nodes)) {
		return collectUnique(
			collectAllNodes(workflow)
				.filter((n) => n.type === "UNETLoader")
				.map((n) => n.widgets_values?.[0])
		);
	}
	return collectUnique(
		Object.values(workflow)
			.filter((n) => n && typeof n === "object" && n.class_type === "UNETLoader")
			.map((n) => n.inputs?.unet_name)
	);
}

// ---- text_encoders 抽出 (CLIPLoader / DualCLIPLoader / TripleCLIPLoader) ----

export function extractTextEncoders(workflow) {
	if (!workflow || typeof workflow !== "object") return [];
	const names = [];
	if (Array.isArray(workflow.nodes)) {
		for (const node of collectAllNodes(workflow)) {
			if (node.type === "CLIPLoader") {
				if (node.widgets_values?.[0]) names.push(node.widgets_values[0]);
			} else if (node.type === "DualCLIPLoader") {
				if (node.widgets_values?.[0]) names.push(node.widgets_values[0]);
				if (node.widgets_values?.[1]) names.push(node.widgets_values[1]);
			} else if (node.type === "TripleCLIPLoader") {
				if (node.widgets_values?.[0]) names.push(node.widgets_values[0]);
				if (node.widgets_values?.[1]) names.push(node.widgets_values[1]);
				if (node.widgets_values?.[2]) names.push(node.widgets_values[2]);
			}
		}
	} else {
		for (const node of Object.values(workflow)) {
			if (!node || typeof node !== "object") continue;
			const ct = node.class_type ?? "";
			if (ct === "CLIPLoader") {
				if (node.inputs?.clip_name) names.push(node.inputs.clip_name);
			} else if (ct === "DualCLIPLoader") {
				if (node.inputs?.clip_name1) names.push(node.inputs.clip_name1);
				if (node.inputs?.clip_name2) names.push(node.inputs.clip_name2);
			} else if (ct === "TripleCLIPLoader") {
				if (node.inputs?.clip_name1) names.push(node.inputs.clip_name1);
				if (node.inputs?.clip_name2) names.push(node.inputs.clip_name2);
				if (node.inputs?.clip_name3) names.push(node.inputs.clip_name3);
			}
		}
	}
	return collectUnique(names);
}

// ---- プロンプト抽出（Positive / Negative） ----

export function extractPrompts(workflow) {
	if (!workflow || typeof workflow !== "object") return { positives: [], negatives: [] };
	return Array.isArray(workflow.nodes)
		? extractPromptsLiteGraph(workflow)
		: extractPromptsAPI(workflow);
}

// ---- API 形式: CLIPTextEncode の text 入力がノードリンクの場合にテキストを解決 ----

function resolveLinkedText(workflow, srcId, slot) {
	const src = workflow[String(srcId)];
	if (!src || typeof src !== "object") return null;
	const ct = src.class_type ?? "";
	// SDXLPromptStyler 系: slot 0 = text_positive, slot 1 = text_negative
	if (ct.includes("PromptStyler")) {
		const v = slot === 0 ? src.inputs?.text_positive : src.inputs?.text_negative;
		return (v && typeof v === "string") ? v : null;
	}
	// 汎用: slot 0 系は text_positive / text、slot 1 系は text_negative / text_l
	const keys = slot === 0
		? ["text_positive", "text", "text_g", "prompt"]
		: ["text_negative", "text_l"];
	for (const k of keys) {
		const v = src.inputs?.[k];
		if (v && typeof v === "string") return v;
	}
	return null;
}

// ---- API 形式（PNG の prompt チャンク等） ----

function extractPromptsAPI(workflow) {
	// ImageMetadataPromptLoader: positive_text / negative_text を直接抽出
	const metaNodes = Object.values(workflow).filter(
		(n) => n?.class_type === "ImageMetadataPromptLoader"
	);
	if (metaNodes.length > 0) {
		const positives = new Set();
		const negatives = new Set();
		for (const n of metaNodes) {
			if (n.inputs?.positive_text) positives.add(n.inputs.positive_text);
			if (n.inputs?.negative_text) negatives.add(n.inputs.negative_text);
		}
		if (positives.size > 0 || negatives.size > 0) {
			return { positives: [...positives], negatives: [...negatives] };
		}
	}

	// テキストエンコーダーノードのマップ: nodeId(string) -> text
	const textMap = new Map();
	for (const [id, node] of Object.entries(workflow)) {
		if (!node || typeof node !== "object") continue;
		if (!isTextEncoderNode(node.class_type ?? "")) continue;

		const rawText =
			node.inputs?.text ??
			node.inputs?.text_g ??
			node.inputs?.text_l ??
			null;

		if (rawText && typeof rawText === "string") {
			textMap.set(id, rawText);
		} else if (Array.isArray(rawText)) {
			// リンク参照 [srcNodeId, slot] → リンク先ノードからテキストを解決
			const text = resolveLinkedText(workflow, rawText[0], rawText[1]);
			if (text) textMap.set(id, text);
		}
	}

	const positives = new Set();
	const negatives = new Set();
	let foundSampler = false;

	for (const node of Object.values(workflow)) {
		if (!node || typeof node !== "object") continue;
		if (!isSamplerNode(node.class_type ?? "")) continue;

		foundSampler = true;
		const inputs = node.inputs ?? {};

		for (const [key, val] of Object.entries(inputs)) {
			if (!Array.isArray(val)) continue;
			const text = textMap.get(String(val[0]));
			if (!text) continue;

			if (key === "positive" || key.startsWith("positive")) {
				positives.add(text);
			} else if (key === "negative" || key.startsWith("negative")) {
				negatives.add(text);
			}
		}
	}

	// フォールバック: サンプラーが見つからないか両方空の場合 → 全テキストを両セクションに表示
	if (!foundSampler || (positives.size === 0 && negatives.size === 0)) {
		const all = [...textMap.values()];
		return { positives: all, negatives: all };
	}

	return { positives: [...positives], negatives: [...negatives] };
}

// ---- LiteGraph 形式（.json ワークフローファイル等） ----

function extractPromptsLiteGraph(workflow) {
	const { nodes, links } = workflow;
	if (!Array.isArray(nodes)) return { positives: [], negatives: [] };

	// ImageMetadataPromptLoader: widgets_values[2]=positive, [3]=negative
	const metaNodes = nodes.filter((n) => n.type === "ImageMetadataPromptLoader");
	if (metaNodes.length > 0) {
		const positives = new Set();
		const negatives = new Set();
		for (const n of metaNodes) {
			const pos = n.widgets_values?.[2];
			const neg = n.widgets_values?.[3];
			if (pos && typeof pos === "string") positives.add(pos);
			if (neg && typeof neg === "string") negatives.add(neg);
		}
		if (positives.size > 0 || negatives.size > 0) {
			return { positives: [...positives], negatives: [...negatives] };
		}
	}

	// WFS_PromptText (Workflow Studio プロンプトプリセットノード)
	// widgets_values[0]=positive, [1]=negative  title=プリセット名
	const wfsPromptNodes = nodes.filter((n) => n.type === "WFS_PromptText");
	if (wfsPromptNodes.length > 0) {
		const positives = new Set();
		const negatives = new Set();
		for (const n of wfsPromptNodes) {
			const pos = n.widgets_values?.[0];
			const neg = n.widgets_values?.[1];
			if (pos && typeof pos === "string") positives.add(pos);
			if (neg && typeof neg === "string") negatives.add(neg);
		}
		if (positives.size > 0 || negatives.size > 0) {
			return { positives: [...positives], negatives: [...negatives] };
		}
	}

	// ノードマップ: id -> node
	const nodeMap = new Map();
	for (const n of nodes) nodeMap.set(n.id, n);

	// リンクマップ: linkId -> originNodeId / originSlot
	// links 配列: [id, origin_id, origin_slot, dest_id, dest_slot, type]
	const linkOrigin = new Map();
	const linkSlot = new Map();
	if (Array.isArray(links)) {
		for (const lk of links) {
			if (Array.isArray(lk)) {
				linkOrigin.set(lk[0], lk[1]);
				linkSlot.set(lk[0], lk[2] ?? 0);
			} else if (lk && typeof lk === "object") {
				const id = lk.id ?? lk[0];
				const origin = lk.origin_id ?? lk[1];
				const slot = lk.origin_slot ?? lk[2] ?? 0;
				if (id != null && origin != null) {
					linkOrigin.set(id, origin);
					linkSlot.set(id, slot);
				}
			}
		}
	}

	// テキストエンコーダーノードのマップ: id -> text
	const textMap = new Map();
	for (const node of nodes) {
		if (!isTextEncoderNode(node.type ?? "")) continue;
		// CLIPTextEncodeSDXL は [text_g, text_l, width, height, ...] の場合もある
		const text = node.widgets_values?.[0];
		if (text && typeof text === "string") {
			textMap.set(node.id, text);
		} else if (Array.isArray(node.inputs)) {
			// テキスト入力がリンクの場合 → リンク先ノードから解決
			const textInput = node.inputs.find(
				(inp) => inp.name === "text" || inp.name === "text_g"
			);
			if (textInput?.link != null) {
				const originId = linkOrigin.get(textInput.link);
				const originSlot = linkSlot.get(textInput.link) ?? 0;
				const srcNode = originId != null ? nodeMap.get(originId) : null;
				if (srcNode) {
					const srcType = srcNode.type ?? "";
					if (srcType.includes("PromptStyler") || srcType === "WFS_PromptText") {
						const v = srcNode.widgets_values?.[originSlot];
						if (v && typeof v === "string") textMap.set(node.id, v);
					}
				}
			}
		}
	}

	const positives = new Set();
	const negatives = new Set();
	let foundSampler = false;

	for (const node of nodes) {
		if (!isSamplerNode(node.type ?? "")) continue;
		if (!Array.isArray(node.inputs)) continue;

		foundSampler = true;

		for (const input of node.inputs) {
			if (!input || input.link == null) continue;

			const originId = linkOrigin.get(input.link);
			if (originId == null) continue;

			const text = textMap.get(originId);
			if (!text) continue;

			const name = input.name ?? "";
			if (name === "positive" || name.startsWith("positive")) {
				positives.add(text);
			} else if (name === "negative" || name.startsWith("negative")) {
				negatives.add(text);
			}
		}
	}

	// フォールバック: サンプラーが見つからないか両方空の場合 → 全テキストを両セクションに表示
	if (!foundSampler || (positives.size === 0 && negatives.size === 0)) {
		const all = [...textMap.values()];
		return { positives: all, negatives: all };
	}

	return { positives: [...positives], negatives: [...negatives] };
}

// ---- すべての PNG テキストチャンク読み取り ----

async function readAllPNGTextChunks(file) {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null;

	const view = new DataView(buffer);
	const latin1 = new TextDecoder("latin1");
	const utf8 = new TextDecoder("utf-8");
	let offset = 8;
	const chunks = {};

	while (offset + 12 <= buffer.byteLength) {
		const length = view.getUint32(offset);
		if (offset + 12 + length > buffer.byteLength) break;
		const type = latin1.decode(bytes.slice(offset + 4, offset + 8));
		const data = bytes.slice(offset + 8, offset + 8 + length);

		if (type === "tEXt") {
			const c = parseTEXtChunk(data, latin1);
			if (c) chunks[c.keyword] = c.text;
		} else if (type === "iTXt") {
			const c = parseITXtChunk(data, latin1, utf8);
			if (c) chunks[c.keyword] = c.text;
		}
		// IEND で止めない: ComfyUI-Custom-Scripts は IEND 後に tEXt workflow チャンクを追記する
		offset += 12 + length;
	}
	return chunks;
}

// ---- SD / SD Forge "parameters" テキスト解析 ----

function parseSDAParameters(raw) {
	const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	// "Steps: <数字>" で始まる行をパラメータ行の起点とする
	const stepsMatch = text.match(/\nSteps:\s+\d/);
	if (!stepsMatch) return null;

	const paramsStart = stepsMatch.index + 1;
	const promptSection = text.slice(0, paramsStart - 1);
	const paramsLine = text.slice(paramsStart);

	// Positive / Negative 分離
	const negSep = "\nNegative prompt: ";
	const negIdx = promptSection.indexOf(negSep);
	let positive = "", negative = "";
	if (negIdx !== -1) {
		positive = promptSection.slice(0, negIdx).trim();
		negative = promptSection.slice(negIdx + negSep.length).trim();
	} else {
		positive = promptSection.trim();
	}

	// "Key: Value" を辞書化（引用符付き値にも対応）
	const params = {};
	const re = /,?\s*([A-Za-z][A-Za-z0-9 ]*):\s*("(?:[^"\\]|\\.)*"|[^,]+)/g;
	let m;
	while ((m = re.exec(paramsLine)) !== null) {
		params[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
	}
	return { positive, negative, params };
}

// ---- Fooocus メタデータ解析 ----

function parseFooocusMetadata(paramsText) {
	let obj;
	try { obj = JSON.parse(paramsText); } catch { return null; }
	if (!obj || typeof obj !== "object" || !obj.base_model) return null;

	const toArray = (v) => !v ? [] : Array.isArray(v) ? v.filter(Boolean) : [String(v)];
	return {
		checkpoint: obj.base_model,
		vae: (obj.vae && obj.vae !== "Default" && obj.vae !== "") ? obj.vae : null,
		positives: toArray(obj.full_prompt ?? obj.prompt),
		negatives: toArray(obj.full_negative_prompt ?? obj.negative_prompt),
	};
}

// ---- 統合メタデータ抽出 ----
// 戻り値: { source, checkpoints, vaes, diffusionModels, textEncoders, positives, negatives } | null

export async function extractAllMetadata(file) {
	const isJSON = file.type === "application/json" || file.name.toLowerCase().endsWith(".json");

	if (isJSON) {
		let workflow;
		try { workflow = JSON.parse(await file.text()); } catch { return null; }
		if (!workflow) return null;
		return {
			source: "comfyui",
			checkpoints: extractCheckpoints(workflow),
			vaes: extractVAEs(workflow),
			diffusionModels: extractDiffusionModels(workflow),
			textEncoders: extractTextEncoders(workflow),
			...extractPrompts(workflow),
		};
	}

	// PNG: 全テキストチャンクを読む
	const chunks = await readAllPNGTextChunks(file);
	if (!chunks) return null;

	// --- ComfyUI (prompt チャンク: API 形式) ---
	if (chunks.prompt) {
		let workflow;
		try { workflow = JSON.parse(chunks.prompt); } catch { return null; }
		return {
			source: "comfyui",
			checkpoints: extractCheckpoints(workflow),
			vaes: extractVAEs(workflow),
			diffusionModels: extractDiffusionModels(workflow),
			textEncoders: extractTextEncoders(workflow),
			...extractPrompts(workflow),
		};
	}

	// --- ComfyUI-Custom-Scripts Workflow Image (workflow チャンク: LiteGraph 形式) ---
	// IEND 後に tEXt workflow チャンクを追記する形式
	if (chunks.workflow) {
		let workflow;
		try { workflow = JSON.parse(chunks.workflow); } catch { return null; }
		return {
			source: "comfyui",
			checkpoints: extractCheckpoints(workflow),
			vaes: extractVAEs(workflow),
			diffusionModels: extractDiffusionModels(workflow),
			textEncoders: extractTextEncoders(workflow),
			...extractPrompts(workflow),
		};
	}

	// --- Fooocus ---
	if (chunks.fooocus_scheme === "fooocus" && chunks.parameters) {
		const f = parseFooocusMetadata(chunks.parameters);
		if (!f) return null;
		return {
			source: "fooocus",
			checkpoints: [f.checkpoint],
			vaes: f.vae ? [f.vae] : [],
			diffusionModels: [],
			textEncoders: [],
			positives: f.positives,
			negatives: f.negatives,
		};
	}

	// --- SD / SD Forge / SD Forge neo ---
	if (chunks.parameters) {
		const p = parseSDAParameters(chunks.parameters);
		if (!p) return null;
		const { positive, negative, params } = p;
		const modelName = params["Model"];
		if (!modelName) return null;

		const positives = positive ? [positive] : [];
		const negatives = negative ? [negative] : [];

		// Module 2 が存在 → UNet + テキストエンコーダー構成
		if (params["Module 2"] != null) {
			const vaes = params["Module 1"] ? [params["Module 1"]] : [];
			const textEncoders = [];
			for (let i = 2; i <= 9; i++) {
				const mod = params[`Module ${i}`];
				if (!mod) break;
				textEncoders.push(mod);
			}
			return {
				source: "sd_forge",
				checkpoints: [],
				vaes,
				diffusionModels: [modelName],
				textEncoders,
				positives,
				negatives,
			};
		}

		// 通常の Checkpoint 構成
		return {
			source: "sd",
			checkpoints: [modelName],
			vaes: params["Module 1"] ? [params["Module 1"]] : [],
			diffusionModels: [],
			textEncoders: [],
			positives,
			negatives,
		};
	}

	return null;
}

// ---- ベストマッチ検索 ----

export function findBestMatch(detected, values) {
	if (!values?.length) return null;
	if (values.includes(detected)) return detected;

	const lower = detected.toLowerCase();
	const ci = values.find((v) => v.toLowerCase() === lower);
	if (ci) return ci;

	const basename = detected.replace(/^.*[/\\]/, "");
	const bn = values.find(
		(v) => v.replace(/^.*[/\\]/, "").toLowerCase() === basename.toLowerCase()
	);
	if (bn) return bn;

	const stem = basename.replace(/\.[^.]+$/, "").toLowerCase();
	return (
		values.find(
			(v) =>
				v.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "").toLowerCase() === stem
		) ?? null
	);
}
