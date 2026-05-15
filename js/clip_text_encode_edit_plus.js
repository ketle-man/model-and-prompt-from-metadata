import { app } from "../../scripts/app.js";

const EDIT_H = 110;
const BTN_H  = 30;
const LBL_H  = 18;
const PAD    = 8;
const MIN_W  = 300;

app.registerExtension({
	name: "Antigravity.CLIPTextEncodeEditPlus",

	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== "CLIPTextEncodeEditPlus") return;

		// ---- 接続変化: text スロットへの接続で text_edit の初期値を設定 ----
		const origConnChange = nodeType.prototype.onConnectionsChange;
		nodeType.prototype.onConnectionsChange = function (type, slot, connected, link_info) {
			origConnChange?.call(this, type, slot, connected, link_info);
			if (type !== 1) return; // INPUT のみ
			const textSlot = this.inputs?.findIndex((i) => i.name === "text");
			if (slot !== textSlot) return;

			if (!connected) {
				this._updateRaw?.("");
				return;
			}
			setTimeout(() => {
				const link = app.graph?.links?.[link_info?.id];
				if (!link) return;
				const origin = app.graph.getNodeById(link.origin_id);
				if (!origin) return;
				// 接続先の出力名と同名のウィジェットから値を取得
				const outName = origin.outputs?.[link.origin_slot]?.name;
				const mw = origin.widgets?.find((w) => w.name === outName);
				if (mw?.value != null) this._updateRaw?.(mw.value);
			}, 100);
		};

		// ---- ノード生成 ----
		const origCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const ret = origCreated?.apply(this, arguments);
			const node = this;

			// ---- コンテナ ----
			const container = document.createElement("div");
			container.style.cssText = "padding:4px 6px;box-sizing:border-box;width:100%;";

			// ---- ボタン行: RAW / EDIT ----
			const btnRow = document.createElement("div");
			btnRow.style.cssText = "display:flex;gap:4px;margin-bottom:5px;";

			function makeBtn(label) {
				const b = document.createElement("button");
				b.textContent = label;
				b.style.cssText =
					"flex:1;padding:4px 0;border-radius:4px;border:1px solid #555;" +
					"cursor:pointer;font-size:11px;font-weight:bold;transition:all 0.15s;";
				return b;
			}

			const rawBtn  = makeBtn("RAW");
			const editBtn = makeBtn("EDIT");
			btnRow.append(rawBtn, editBtn);

			function setMode(mode) {
				const mw = node.widgets?.find((w) => w.name === "mode");
				if (mw) mw.value = mode;

				if (mode === "RAW") {
					rawBtn.style.background  = "#4a9eff"; rawBtn.style.color  = "#fff"; rawBtn.style.borderColor  = "#4a9eff";
					editBtn.style.background = "rgba(255,255,255,0.05)"; editBtn.style.color = "#aaa"; editBtn.style.borderColor = "#555";
				} else {
					editBtn.style.background = "#4a9eff"; editBtn.style.color = "#fff"; editBtn.style.borderColor = "#4a9eff";
					rawBtn.style.background  = "rgba(255,255,255,0.05)"; rawBtn.style.color  = "#aaa"; rawBtn.style.borderColor  = "#555";
				}
				node.setDirtyCanvas(true, true);
			}

			rawBtn.addEventListener("click",  () => setMode("RAW"));
			editBtn.addEventListener("click", () => setMode("EDIT"));

			// ---- EDIT テキストエリア ----
			const editLbl = document.createElement("div");
			editLbl.textContent = "EDIT";
			editLbl.style.cssText =
				"font-size:10px;color:#888;margin-bottom:3px;padding-left:2px;";

			const editArea = document.createElement("textarea");
			editArea.style.cssText =
				"width:100%;background:rgba(0,0,0,0.35);border:1px solid #555;border-radius:4px;" +
				`padding:6px 8px;font-size:11px;color:#ddd;line-height:1.5;` +
				`resize:none;box-sizing:border-box;font-family:monospace;height:${EDIT_H}px;`;
			editArea.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
			editArea.addEventListener("input", () => {
				const ew = node.widgets?.find((w) => w.name === "text_edit");
				if (ew) ew.value = editArea.value;
			});

			container.append(btnRow, editLbl, editArea);

			// ---- text_edit 初期値設定（接続時に呼ばれる） ----
			node._updateRaw = function (text) {
				const ew = node.widgets?.find((w) => w.name === "text_edit");
				if (ew && !ew.value) {
					ew.value = text ?? "";
					editArea.value = text ?? "";
				}
			};

			// ---- DOM ウィジェット登録 ----
			const domW = node.addDOMWidget(
				"clip_text_edit_zone", "clip_text_edit_zone", container,
				{ getValue() { return ""; }, setValue() {} }
			);

			function refreshSize() {
				const s = node.computeSize();
				s[0] = Math.max(s[0], MIN_W);
				node.setSize(s);
				node.setDirtyCanvas(true, true);
			}

			domW.computeSize = function (width) {
				const h = PAD + BTN_H + 5 + LBL_H + EDIT_H + PAD;
				return [width, h];
			};

			// ---- 初期化（ウィジェット登録後） ----
			setTimeout(() => {
				for (const name of ["text_edit", "mode"]) {
					const w = node.widgets?.find((w) => w.name === name);
					if (!w) continue;
					w.type = "hidden";
					w.hidden = true;
					w.computeSize = () => [0, -4];
					if (w.element) w.element.style.display = "none";
				}

				const ew = node.widgets?.find((w) => w.name === "text_edit");
				if (ew?.value) editArea.value = ew.value;

				const mw = node.widgets?.find((w) => w.name === "mode");
				setMode(mw?.value ?? "RAW");

				refreshSize();
			}, 30);

			return ret;
		};
	},
});
