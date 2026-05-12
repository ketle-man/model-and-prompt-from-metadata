import { app } from "../../scripts/app.js";
import { extractAllMetadata, findBestMatch, MAX_FILE_SIZE } from "./workflow_utils.js";
import { t, VAE_NONE_VALUE } from "./i18n.js";

// ---- サイズ定数 ----
const DROP_H = 76;
const SECTION_H = 22;
const ITEM_H = 26;
const PROMPT_H = 24;
const PREVIEW_H = 200;
const NOTE_H = 20;
const MAX_CKPT = 4;
const MAX_VAE = 4;
const MAX_PROMPT = 3;
const MAX_INFO = 4;

app.registerExtension({
	name: "Antigravity.MetadataPromptLoader",

	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== "ImageMetadataPromptLoader") return;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const ret = onNodeCreated?.apply(this, arguments);
			const node = this;

			// positive_text / negative_text ウィジェットを隠す
			setTimeout(() => {
				for (const name of ["positive_text", "negative_text"]) {
					const w = node.widgets?.find((w) => w.name === name);
					if (!w) continue;
					w.type = "hidden";
					w.hidden = true;
					w.computeSize = () => [0, -4];
					if (w.element) w.element.style.display = "none";
				}
				refreshNodeSize();
			}, 20);

			// ---- コンテナ ----
			const container = document.createElement("div");
			container.style.cssText = "padding:4px 6px;box-sizing:border-box;width:100%;";

			// ---- ドロップゾーン ----
			const zone = document.createElement("div");
			zone.style.cssText =
				"border:2px dashed #555;border-radius:6px;padding:10px 8px;" +
				"text-align:center;cursor:pointer;color:#aaa;font-size:11px;" +
				"transition:border-color 0.15s,background 0.15s;" +
				"min-height:56px;display:flex;flex-direction:column;" +
				"align-items:center;justify-content:center;gap:2px;box-sizing:border-box;";

			const mainTxt = document.createElement("div");
			mainTxt.textContent = t("drop_main");
			mainTxt.style.cssText = "font-size:12px;font-weight:bold;pointer-events:none;";

			const subTxt = document.createElement("div");
			subTxt.textContent = t("drop_sub");
			subTxt.style.cssText = "font-size:10px;pointer-events:none;";

			const statusTxt = document.createElement("div");
			statusTxt.style.cssText =
				"font-size:10px;margin-top:2px;pointer-events:none;" +
				"max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

			zone.append(mainTxt, subTxt, statusTxt);
			container.appendChild(zone);

			// ---- セクション生成ヘルパー ----
			function makeSection() {
				const section = document.createElement("div");
				section.style.cssText = "display:none;margin-top:5px;";
				const header = document.createElement("div");
				header.style.cssText =
					"font-size:10px;color:#888;margin-bottom:3px;padding-left:2px;";
				const list = document.createElement("div");
				list.style.cssText =
					"display:flex;flex-direction:column;gap:2px;overflow-y:auto;";
				list.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
				section.append(header, list);
				container.appendChild(section);
				return { section, header, list };
			}

			const ckptSec = makeSection();
			const vaeSec = makeSection();
			const posSec = makeSection();
			const negSec = makeSection();

			// ---- diffusion_models / text_encoders 情報セクション ----
			const infoSection = document.createElement("div");
			infoSection.style.cssText = "display:none;margin-top:5px;";
			const infoHeader = document.createElement("div");
			infoHeader.style.cssText =
				"font-size:10px;color:#f90;margin-bottom:3px;padding-left:2px;font-weight:bold;";
			const infoNote = document.createElement("div");
			infoNote.style.cssText =
				"font-size:10px;color:#c80;padding:2px 6px;margin-bottom:3px;" +
				"border-left:2px solid #f90;display:none;";
			const infoList = document.createElement("div");
			infoList.style.cssText = "display:flex;flex-direction:column;gap:2px;overflow-y:auto;";
			infoList.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
			infoSection.append(infoHeader, infoNote, infoList);
			container.appendChild(infoSection);

			// ---- プレビューエリア ----
			const previewWrap = document.createElement("div");
			previewWrap.style.cssText = "display:none;margin-top:5px;";

			const previewLabel = document.createElement("div");
			previewLabel.style.cssText =
				"font-size:10px;color:#888;margin-bottom:3px;padding-left:2px;";

			const previewBox = document.createElement("div");
			previewBox.style.cssText =
				"background:rgba(0,0,0,0.25);border:1px solid #444;border-radius:4px;" +
				"padding:6px 8px;font-size:10px;color:#ccc;line-height:1.5;" +
				"overflow-y:auto;white-space:pre-wrap;word-break:break-all;" +
				"max-height:" + (PREVIEW_H - 22) + "px;box-sizing:border-box;";
			previewBox.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

			previewWrap.append(previewLabel, previewBox);
			container.appendChild(previewWrap);

			// ---- 隠しファイル入力 ----
			const fileInput = document.createElement("input");
			fileInput.type = "file";
			fileInput.accept = "image/png,.json,application/json";
			fileInput.style.display = "none";
			container.appendChild(fileInput);

			function setStatus(msg, color = "#aaa") {
				statusTxt.textContent = msg;
				statusTxt.style.color = color;
			}

			// ---- ノードサイズ管理 ----
			let ckptVC = 0, vaeVC = 0, posVC = 0, negVC = 0, infoVC = 0;
			let previewVisible = false;

			function refreshNodeSize() {
				const s = node.computeSize();
				s[0] = Math.max(s[0], 286);
				node.setSize(s);
				node.setDirtyCanvas(true, true);
			}

			// ---- 選択ハイライト ----
			function applySelect(list, item) {
				list.querySelectorAll("[data-selected]").forEach((el) => {
					delete el.dataset.selected;
					el.style.background = "rgba(255,255,255,0.04)";
				});
				item.dataset.selected = "1";
				item.style.background = "rgba(74,158,255,0.25)";
			}

			// ---- モデル系アイテム生成（✓ / ✗ バッジ） ----
			function buildModelItem(label, matchedValue, listEl, onSelect) {
				const isNone = matchedValue === VAE_NONE_VALUE;
				const clickable = isNone || matchedValue !== null;

				const item = document.createElement("div");
				item.style.cssText =
					"display:flex;align-items:center;gap:5px;padding:4px 6px;" +
					"border-radius:4px;font-size:10px;box-sizing:border-box;" +
					"background:rgba(255,255,255,0.04);" +
					(clickable ? "cursor:pointer;transition:background 0.1s;" : "cursor:default;");

				const badge = document.createElement("span");
				badge.style.cssText = "font-size:11px;font-weight:bold;flex-shrink:0;";
				if (isNone) { badge.textContent = "◯"; badge.style.color = "#777"; }
				else if (matchedValue !== null) { badge.textContent = "✓"; badge.style.color = "#4c9"; }
				else { badge.textContent = "✗"; badge.style.color = "#f44"; }

				const nameEl = document.createElement("span");
				nameEl.textContent = label;
				nameEl.title = label;
				nameEl.style.cssText =
					"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" +
					"color:" + (isNone ? "#777" : clickable ? "#ddd" : "#555") + ";";

				item.append(badge, nameEl);

				if (clickable) {
					item.addEventListener("mouseenter", () => {
						if (!item.dataset.selected) item.style.background = "rgba(74,158,255,0.15)";
					});
					item.addEventListener("mouseleave", () => {
						if (!item.dataset.selected) item.style.background = "rgba(255,255,255,0.04)";
					});
					item.addEventListener("click", () => {
						onSelect(item, matchedValue);
						applySelect(listEl, item);
					});
				}
				return item;
			}

			// ---- 情報アイテム生成（クリック不可） ----
			function buildInfoItem(label, color) {
				const item = document.createElement("div");
				item.style.cssText =
					"display:flex;align-items:center;gap:5px;padding:3px 6px;" +
					"border-radius:4px;font-size:10px;box-sizing:border-box;" +
					"background:rgba(255,255,255,0.04);cursor:default;";
				const badge = document.createElement("span");
				badge.textContent = "■";
				badge.style.cssText = "font-size:8px;flex-shrink:0;color:" + color + ";";
				const nameEl = document.createElement("span");
				nameEl.textContent = label;
				nameEl.title = label;
				nameEl.style.cssText =
					"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#999;";
				item.append(badge, nameEl);
				return item;
			}

			// ---- diffusion_models / text_encoders セクション描画 ----
			let metaSource = "comfyui";

			function renderInfoSection(diffModels, textEncoders) {
				infoList.innerHTML = "";
				infoNote.style.display = "none";
				if (diffModels.length === 0 && textEncoders.length === 0) {
					infoSection.style.display = "none";
					return 0;
				}
				infoHeader.textContent = t("diff_detected");
				infoNote.textContent = metaSource === "comfyui" ? t("diff_note") : t("diff_note_sd");
				infoNote.style.display = "block";
				for (const name of diffModels) infoList.appendChild(buildInfoItem(name, "#8af"));
				for (const name of textEncoders) infoList.appendChild(buildInfoItem(name, "#fa8"));
				const total = diffModels.length + textEncoders.length;
				const visible = Math.min(total, MAX_INFO);
				infoList.style.maxHeight = visible * ITEM_H + "px";
				infoSection.style.display = "block";
				return visible;
			}

			// ---- プロンプトアイテム生成（1行・クリックでプレビュー） ----
			function buildPromptItem(text, badgeChar, badgeColor, listEl, widgetName) {
				const item = document.createElement("div");
				item.style.cssText =
					"display:flex;align-items:center;gap:5px;padding:3px 6px;" +
					"border-radius:4px;font-size:10px;box-sizing:border-box;" +
					"background:rgba(255,255,255,0.04);cursor:pointer;transition:background 0.1s;";

				const badge = document.createElement("span");
				badge.textContent = badgeChar;
				badge.style.cssText =
					"font-size:10px;font-weight:bold;flex-shrink:0;color:" + badgeColor + ";";

				const lineEl = document.createElement("span");
				lineEl.textContent = text.replace(/\n/g, " ").trim();
				lineEl.style.cssText =
					"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
					"flex:1;color:#ccc;";

				item.append(badge, lineEl);

				item.addEventListener("mouseenter", () => {
					if (!item.dataset.selected) item.style.background = "rgba(74,158,255,0.15)";
				});
				item.addEventListener("mouseleave", () => {
					if (!item.dataset.selected) item.style.background = "rgba(255,255,255,0.04)";
				});
				item.addEventListener("click", () => {
					applySelect(listEl, item);

					// 隠しウィジェットに値を直接設定（callbackは呼ばない）
					const w = node.widgets?.find((ww) => ww.name === widgetName);
					if (w) w.value = text;
					node.setDirtyCanvas(true, true);

					// プレビュー表示
					const isPos = widgetName === "positive_text";
					previewLabel.textContent = isPos ? t("preview_pos") : t("preview_neg");
					previewLabel.style.color = isPos ? "#4a9" : "#e84";
					previewBox.textContent = text;

					const wasVisible = previewVisible;
					previewWrap.style.display = "block";
					previewVisible = true;

					if (!wasVisible) refreshNodeSize();
				});

				return item;
			}

			// ---- Checkpoint セクション描画 ----
			function renderCkptSection(checkpoints) {
				const { section, header, list } = ckptSec;
				list.innerHTML = "";
				if (checkpoints.length === 0) { section.style.display = "none"; return 0; }

				const widget = node.widgets?.find((w) => w.name === "ckpt_name");
				const values = widget?.options?.values ?? [];
				const items = checkpoints.map((n) => ({ label: n, matched: findBestMatch(n, values) }));
				const installed = items.filter((i) => i.matched !== null).length;
				header.textContent = t("ckpt_header", checkpoints.length, installed);

				for (const { label, matched } of items) {
					list.appendChild(buildModelItem(label, matched, list, (el, val) => {
						if (!widget) return;
						widget.value = val;
						if (widget.callback) widget.callback(val);
						node.setDirtyCanvas(true, true);
					}));
				}

				const visible = Math.min(items.length, MAX_CKPT);
				list.style.maxHeight = visible * ITEM_H + "px";
				section.style.display = "block";
				if (checkpoints.length === 1 && installed === 1) list.querySelector("div")?.click();
				return visible;
			}

			// ---- VAE セクション描画 ----
			function renderVaeSection(vaes) {
				const { section, header, list } = vaeSec;
				list.innerHTML = "";

				const widget = node.widgets?.find((w) => w.name === "vae_name");
				const values = widget?.options?.values ?? [];
				const detected = vaes.map((n) => ({ label: n, matched: findBestMatch(n, values) }));
				const installed = detected.filter((i) => i.matched !== null).length;
				header.textContent = vaes.length > 0
					? t("vae_header", vaes.length, installed)
					: t("vae_no_loader");

				const allItems = [{ label: t("none"), matched: VAE_NONE_VALUE }, ...detected];
				const itemEls = [];
				for (const { label, matched } of allItems) {
					const el = buildModelItem(label, matched, list, (el, val) => {
						if (!widget) return;
						widget.value = val;
						if (widget.callback) widget.callback(val);
						node.setDirtyCanvas(true, true);
					});
					list.appendChild(el);
					itemEls.push(el);
				}

				const visible = Math.min(allItems.length, MAX_VAE);
				list.style.maxHeight = visible * ITEM_H + "px";
				section.style.display = "block";

				// 自動選択: インストール済み1件 → そのVAEを選択、検出なし → なしを選択
				if (installed === 1) {
					const idx = allItems.findIndex((item, i) => i > 0 && item.matched !== null);
					if (idx !== -1) itemEls[idx]?.click();
				} else if (vaes.length === 0) {
					itemEls[0]?.click();
				}

				return visible;
			}

			// ---- プロンプト セクション描画 ----
			function renderPromptSection(sec, prompts, label, badgeChar, badgeColor, widgetName, isFallback) {
				const { section, header, list } = sec;
				list.innerHTML = "";
				if (prompts.length === 0) { section.style.display = "none"; return 0; }

				header.textContent = isFallback
					? t("prompt_fallback", label, prompts.length)
					: t("prompt_header", label, prompts.length);
				header.style.color = badgeColor;

				for (const text of prompts) {
					list.appendChild(buildPromptItem(text, badgeChar, badgeColor, list, widgetName));
				}

				const visible = Math.min(prompts.length, MAX_PROMPT);
				list.style.maxHeight = visible * PROMPT_H + "px";
				section.style.display = "block";
				return visible;
			}

			// ---- ファイル処理 ----
			async function handleFile(file) {
				if (!file) return;
				if (file.size > MAX_FILE_SIZE) {
					setStatus(t("file_too_large"), "#f90");
					return;
				}
				setStatus(t("parsing"), "#aaa");

				// 全セクションリセット
				for (const s of [ckptSec, vaeSec, posSec, negSec]) {
					s.list.innerHTML = "";
					s.section.style.display = "none";
				}
				infoList.innerHTML = "";
				infoSection.style.display = "none";
				infoNote.style.display = "none";
				previewWrap.style.display = "none";
				ckptVC = vaeVC = posVC = negVC = infoVC = 0;
				previewVisible = false;

				try {
					const meta = await extractAllMetadata(file);
					if (!meta) {
						setStatus(t("no_metadata"), "#f90");
						refreshNodeSize();
						return;
					}

					const { checkpoints, vaes, diffusionModels: diffModels, textEncoders, positives, negatives } = meta;
					metaSource = meta.source;
					const hasDiff = diffModels.length > 0 || textEncoders.length > 0;

					if (!checkpoints.length && !vaes.length && !positives.length && !negatives.length && !hasDiff) {
						setStatus(t("no_info"), "#f90");
						refreshNodeSize();
						return;
					}

					setStatus("");
					ckptVC = renderCkptSection(checkpoints);
					vaeVC = renderVaeSection(vaes);
					// positive と negative が同一内容の場合はフォールバックと見なす
					const isFallback =
						positives.length > 0 &&
						positives.length === negatives.length &&
						positives.every((p, i) => p === negatives[i]);
					posVC = renderPromptSection(posSec, positives, t("label_positive"), "＋", "#4a9", "positive_text", isFallback);
					negVC = renderPromptSection(negSec, negatives, t("label_negative"), "－", "#e84", "negative_text", isFallback);
					infoVC = renderInfoSection(diffModels, textEncoders);
					refreshNodeSize();

				} catch (err) {
					console.error("[MetadataPrompt]", err);
					setStatus(t("error_prefix") + t("error_parse"), "#f44");
					refreshNodeSize();
				}
			}

			// ---- ドラッグ&ドロップ ----
			zone.addEventListener("dragover", (e) => {
				e.preventDefault(); e.stopPropagation();
				zone.style.borderColor = "#4a9eff";
				zone.style.background = "rgba(74,158,255,0.08)";
			});
			zone.addEventListener("dragleave", (e) => {
				e.stopPropagation();
				zone.style.borderColor = "#555";
				zone.style.background = "";
			});
			zone.addEventListener("drop", (e) => {
				e.preventDefault(); e.stopPropagation();
				zone.style.borderColor = "#555";
				zone.style.background = "";
				handleFile(e.dataTransfer.files?.[0]);
			});

			zone.addEventListener("click", () => fileInput.click());
			fileInput.addEventListener("change", () => {
				handleFile(fileInput.files?.[0]);
				fileInput.value = "";
			});

			// ---- DOM ウィジェット登録 ----
			const domWidget = node.addDOMWidget(
				"metadata_prompt_zone", "metadata_prompt_zone", container,
				{ getValue() { return ""; }, setValue() {} }
			);

			domWidget.computeSize = function (width) {
				const zoneH = (zone.offsetHeight || (DROP_H - 8)) + 8;
				let h = zoneH;
				if (ckptVC > 0) h += 6 + SECTION_H + ckptVC * ITEM_H;
				if (vaeVC > 0) h += 6 + SECTION_H + vaeVC * ITEM_H;
				if (posVC > 0) h += 6 + SECTION_H + posVC * PROMPT_H;
				if (negVC > 0) h += 6 + SECTION_H + negVC * PROMPT_H;
				if (infoSection.style.display !== "none")
					h += 6 + SECTION_H + NOTE_H + infoVC * ITEM_H;
				if (previewVisible) h += 6 + PREVIEW_H;
				return [width, h + 4];
			};

			return ret;
		};
	},
});
