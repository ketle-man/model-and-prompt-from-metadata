import { app } from "../../scripts/app.js";
import { extractAllMetadata, findBestMatch, MAX_FILE_SIZE } from "./workflow_utils.js";
import { t } from "./i18n.js";

const LORA_NONE = "None";
const NUM_SLOTS = 3;

app.registerExtension({
	name: "Antigravity.MetadataLoRALoader",

	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== "ImageMetadataLoRALoader") return;

		// ---- METADATA 入力が接続されたときに自動取得 ----
		const onConnectionsChange = nodeType.prototype.onConnectionsChange;
		nodeType.prototype.onConnectionsChange = function (type, slot, connected, link_info) {
			onConnectionsChange?.call(this, type, slot, connected, link_info);
			// type 1 = INPUT
			if (type !== 1 || !connected) return;
			const metaSlot = this.inputs?.findIndex((i) => i.name === "metadata");
			if (metaSlot < 0 || slot !== metaSlot) return;
			const self = this;
			setTimeout(() => {
				const link = app.graph?.links?.[link_info?.id];
				if (!link) return;
				const originNode = app.graph.getNodeById(link.origin_id);
				if (!originNode) return;
				const mw = originNode.widgets?.find((w) => w.name === "_metadata_json");
				if (!mw?.value) return;
				try {
					const meta = JSON.parse(mw.value);
					if (Array.isArray(meta?.loras) && meta.loras.length > 0) {
						self._receiveMetadata?.(meta.loras);
					}
				} catch {}
			}, 100);
		};

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

			// ---- LoRA リスト セクション ----
			const loraSection = document.createElement("div");
			loraSection.style.cssText = "display:none;margin-top:5px;";
			const loraHeader = document.createElement("div");
			loraHeader.style.cssText = "font-size:10px;color:#888;margin-bottom:3px;padding-left:2px;";
			const loraListEl = document.createElement("div");
			loraListEl.style.cssText = "display:flex;flex-direction:column;gap:2px;overflow-y:auto;";
			loraListEl.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
			loraSection.append(loraHeader, loraListEl);
			container.appendChild(loraSection);

			// ---- 隠しファイル入力 ----
			const fileInput = document.createElement("input");
			fileInput.type = "file";
			fileInput.accept = "image/png,image/webp,.json,application/json";
			fileInput.style.display = "none";
			container.appendChild(fileInput);

			function setStatus(msg, color = "#aaa") {
				statusTxt.textContent = msg;
				statusTxt.style.color = color;
			}

			const ITEM_H = 26, DROP_H = 76, SECTION_H = 22, MAX_VISIBLE = 6;
			const MIN_W = 286;
			let loraVisibleCount = 0;

			function refreshNodeSize() {
				const s = node.computeSize();
				s[0] = Math.max(s[0], MIN_W);
				node.setSize(s);
				node.setDirtyCanvas(true, true);
			}

			// ---- スロット管理 ----
			// slotAssignments[i] = マッチしたファイル名 or null
			const slotAssignments = [null, null, null];

			function getLoraWidgetValues() {
				const w = node.widgets?.find((w) => w.name === "lora_1");
				return w?.options?.values ?? [];
			}

			function assignToSlot(matched, slotIdx, sm, sc) {
				slotAssignments[slotIdx] = matched;
				const lw = node.widgets?.find((w) => w.name === `lora_${slotIdx + 1}`);
				if (lw) { lw.value = matched; if (lw.callback) lw.callback(matched); }
				if (sm != null) {
					const smw = node.widgets?.find((w) => w.name === `strength_model_${slotIdx + 1}`);
					if (smw) { smw.value = sm; if (smw.callback) smw.callback(sm); }
				}
				if (sc != null) {
					const scw = node.widgets?.find((w) => w.name === `strength_clip_${slotIdx + 1}`);
					if (scw) { scw.value = sc; if (scw.callback) scw.callback(sc); }
				}
				node.setDirtyCanvas(true, true);
			}

			function clearSlot(slotIdx) {
				slotAssignments[slotIdx] = null;
				const lw = node.widgets?.find((w) => w.name === `lora_${slotIdx + 1}`);
				if (lw) { lw.value = LORA_NONE; if (lw.callback) lw.callback(LORA_NONE); }
				node.setDirtyCanvas(true, true);
			}

			// ---- 検出済み LoRA データ ----
			let detectedLoras = [];

			function renderLoraList() {
				loraListEl.innerHTML = "";
				if (detectedLoras.length === 0) {
					loraSection.style.display = "none";
					loraVisibleCount = 0;
					return;
				}

				const values = getLoraWidgetValues();
				const installed = detectedLoras.filter(
					(l) => findBestMatch(l.name, values) !== null
				).length;
				loraHeader.textContent = t("lora_header", detectedLoras.length, installed);

				for (const lora of detectedLoras) {
					const matched = findBestMatch(lora.name, values);
					const clickable = matched !== null;
					const slotIdx = matched !== null ? slotAssignments.indexOf(matched) : -1;
					const isAssigned = slotIdx >= 0;
					const allFull = clickable && !isAssigned && slotAssignments.indexOf(null) === -1;

					const item = document.createElement("div");
					item.style.cssText =
						"display:flex;align-items:center;gap:5px;padding:4px 6px;" +
						"border-radius:4px;font-size:10px;box-sizing:border-box;" +
						"background:" + (isAssigned ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.04)") + ";" +
						(clickable ? "cursor:pointer;transition:background 0.1s;" : "cursor:default;");

					const badge = document.createElement("span");
					badge.style.cssText = "font-size:11px;font-weight:bold;flex-shrink:0;";
					if (!clickable) { badge.textContent = "✗"; badge.style.color = "#f44"; }
					else { badge.textContent = "✓"; badge.style.color = "#4c9"; }

					const nameEl = document.createElement("span");
					nameEl.textContent = lora.name;
					nameEl.title = lora.name;
					nameEl.style.cssText =
						"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" +
						"color:" + (clickable ? "#ddd" : "#555") + ";";

					const slotBadge = document.createElement("span");
					slotBadge.style.cssText =
						"font-size:10px;flex-shrink:0;min-width:20px;text-align:right;" +
						"color:#4a9eff;font-weight:bold;";
					slotBadge.textContent = isAssigned ? `[${slotIdx + 1}]` : (allFull ? "–" : "");

					item.append(badge, nameEl, slotBadge);

					if (clickable) {
						item.addEventListener("mouseenter", () => {
							if (!isAssigned) item.style.background = "rgba(74,158,255,0.15)";
						});
						item.addEventListener("mouseleave", () => {
							if (!isAssigned) item.style.background =
								isAssigned ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.04)";
						});
						item.addEventListener("click", () => {
							const curSlot = slotAssignments.indexOf(matched);
							if (curSlot >= 0) {
								clearSlot(curSlot);
							} else {
								const nextFree = slotAssignments.indexOf(null);
								if (nextFree >= 0) {
									assignToSlot(matched, nextFree, lora.strength_model, lora.strength_clip);
								}
							}
							renderLoraList();
						});
					}

					loraListEl.appendChild(item);
				}

				const visible = Math.min(detectedLoras.length, MAX_VISIBLE);
				loraListEl.style.maxHeight = visible * ITEM_H + "px";
				loraSection.style.display = "block";
				loraVisibleCount = visible;
			}

			// ---- ファイル処理 ----
			async function handleFile(file) {
				if (!file) return;
				if (file.size > MAX_FILE_SIZE) {
					setStatus(t("file_too_large"), "#f90");
					return;
				}
				setStatus(t("parsing"), "#aaa");
				detectedLoras = [];
				loraListEl.innerHTML = "";
				loraSection.style.display = "none";
				loraVisibleCount = 0;
				for (let i = 0; i < NUM_SLOTS; i++) clearSlot(i);

				try {
					const meta = await extractAllMetadata(file);
					if (!meta) {
						setStatus(t("no_metadata"), "#f90");
						refreshNodeSize();
						return;
					}

					const loras = meta.loras ?? [];
					if (loras.length === 0) {
						setStatus(t("no_lora"), "#f90");
						refreshNodeSize();
						return;
					}

					detectedLoras = loras;
					setStatus("");

					// 自動割り当て: インストール済みの LoRA を順番にスロットへ
					const values = getLoraWidgetValues();
					let nextSlot = 0;
					for (const lora of loras) {
						if (nextSlot >= NUM_SLOTS) break;
						const matched = findBestMatch(lora.name, values);
						if (matched !== null) {
							assignToSlot(matched, nextSlot, lora.strength_model, lora.strength_clip);
							nextSlot++;
						}
					}

					renderLoraList();
					refreshNodeSize();

				} catch (err) {
					console.error("[MetadataLoRALoader]", err);
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
				"metadata_lora_zone", "metadata_lora_zone", container,
				{ getValue() { return ""; }, setValue() {} }
			);

			domWidget.computeSize = function (width) {
				const zoneH = (zone.offsetHeight || (DROP_H - 8)) + 8;
				let h = zoneH;
				if (loraVisibleCount > 0) h += 6 + SECTION_H + loraVisibleCount * ITEM_H;
				return [width, h];
			};

			// ---- 上流ノードからメタデータを受け取る ----
			node._receiveMetadata = function (loras) {
				for (let i = 0; i < NUM_SLOTS; i++) clearSlot(i);
				if (!Array.isArray(loras) || loras.length === 0) {
					detectedLoras = [];
					setStatus(t("no_lora"), "#f90");
					renderLoraList();
					refreshNodeSize();
					return;
				}
				detectedLoras = loras;
				setStatus("");

				const values = getLoraWidgetValues();
				let nextSlot = 0;
				for (const lora of loras) {
					if (nextSlot >= NUM_SLOTS) break;
					const matched = findBestMatch(lora.name, values);
					if (matched !== null) {
						assignToSlot(matched, nextSlot, lora.strength_model, lora.strength_clip);
						nextSlot++;
					}
				}

				renderLoraList();
				refreshNodeSize();
			};

			setTimeout(() => refreshNodeSize(), 20);
			return ret;
		};
	},
});
