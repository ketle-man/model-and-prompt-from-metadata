import { app } from "../../scripts/app.js";
import { extractAllMetadata, findBestMatch, MAX_FILE_SIZE } from "./workflow_utils.js";
import { t, VAE_NONE_VALUE } from "./i18n.js";

app.registerExtension({
	name: "Antigravity.MetadataCheckpointLoader",

	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== "ImageMetadataCheckpointLoader") return;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const ret = onNodeCreated?.apply(this, arguments);
			const node = this;

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
				header.style.cssText = "font-size:10px;color:#888;margin-bottom:3px;padding-left:2px;";
				const list = document.createElement("div");
				list.style.cssText = "display:flex;flex-direction:column;gap:2px;overflow-y:auto;";
				list.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
				section.append(header, list);
				container.appendChild(section);
				return { section, header, list };
			}

			const ckptSec = makeSection();
			const vaeSec = makeSection();

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

			// ---- サイズ定数 ----
			const ITEM_H = 26, DROP_H = 76, SECTION_H = 22, MAX_VISIBLE = 4;
			const NOTE_H = 20, MAX_INFO = 4, MIN_W = 286;
			let ckptVisibleCount = 0, vaeVisibleCount = 0, infoVisibleCount = 0;

			function refreshNodeSize() {
				const s = node.computeSize();
				s[0] = Math.max(s[0], MIN_W);
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

			// ---- アイテム生成 ----
			function buildItem(label, matchedValue, listEl, onSelect) {
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
					list.appendChild(buildItem(label, matched, list, (el, val) => {
						if (!widget) return;
						widget.value = val;
						if (widget.callback) widget.callback(val);
						node.setDirtyCanvas(true, true);
					}));
				}

				const visible = Math.min(items.length, MAX_VISIBLE);
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
					const el = buildItem(label, matched, list, (el, val) => {
						if (!widget) return;
						widget.value = val;
						if (widget.callback) widget.callback(val);
						node.setDirtyCanvas(true, true);
					});
					list.appendChild(el);
					itemEls.push(el);
				}

				const visible = Math.min(allItems.length, MAX_VISIBLE);
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

			// ---- ファイル処理 ----
			async function handleFile(file) {
				if (!file) return;
				if (file.size > MAX_FILE_SIZE) {
					setStatus(t("file_too_large"), "#f90");
					return;
				}
				setStatus(t("parsing"), "#aaa");
				ckptSec.list.innerHTML = "";
				vaeSec.list.innerHTML = "";
				ckptSec.section.style.display = "none";
				vaeSec.section.style.display = "none";
				infoList.innerHTML = "";
				infoSection.style.display = "none";
				infoNote.style.display = "none";
				ckptVisibleCount = 0;
				vaeVisibleCount = 0;
				infoVisibleCount = 0;

				try {
					const meta = await extractAllMetadata(file);
					if (!meta) {
						setStatus(t("no_metadata"), "#f90");
						refreshNodeSize();
						return;
					}

					const { checkpoints, vaes, diffusionModels: diffModels, textEncoders } = meta;
					metaSource = meta.source;
					const hasDiff = diffModels.length > 0 || textEncoders.length > 0;

					if (checkpoints.length === 0 && vaes.length === 0 && !hasDiff) {
						setStatus(t("no_ckpt_vae"), "#f90");
						refreshNodeSize();
						return;
					}

					setStatus("");
					ckptVisibleCount = renderCkptSection(checkpoints);
					vaeVisibleCount = renderVaeSection(vaes);
					infoVisibleCount = renderInfoSection(diffModels, textEncoders);
					refreshNodeSize();

				} catch (err) {
					console.error("[MetadataCheckpoint]", err);
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
				"metadata_drop_zone", "metadata_drop_zone", container,
				{ getValue() { return ""; }, setValue() {} }
			);

			domWidget.computeSize = function (width) {
				const zoneH = (zone.offsetHeight || (DROP_H - 8)) + 8;
				let h = zoneH;
				if (ckptVisibleCount > 0) h += 6 + SECTION_H + ckptVisibleCount * ITEM_H;
				if (vaeVisibleCount > 0) h += 6 + SECTION_H + vaeVisibleCount * ITEM_H;
				if (infoSection.style.display !== "none")
					h += 6 + SECTION_H + NOTE_H + infoVisibleCount * ITEM_H;
				return [width, h];
			};

			setTimeout(() => refreshNodeSize(), 20);
			return ret;
		};
	},
});
