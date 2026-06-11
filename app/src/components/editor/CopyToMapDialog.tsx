import { useState, useEffect, useMemo } from "react";
import { cmd } from "@/lib/commands";
import { log } from "@/lib/util/log";
import type { MapMeta } from "@/bindings.gen";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { HotkeyInput } from "@/components/primitives/HotkeyInput";
import { useMapSetting } from "@/components/editor/map/useMapSetting";
import { getMapCopyBindingKey, withMapCopyBinding } from "@/lib/map/mapKeyBindings";
import { getCurrentMapId } from "@/store/useMapStore";

/** Assign per-map hotkeys that copy the active location into other maps (#36).
 *  Bindings persist to this map's settings as they are changed. */
export function CopyToMapDialog({ onClose }: { onClose: () => void }) {
	const [maps, setMaps] = useState<MapMeta[] | null>(null);
	const [filter, setFilter] = useState("");
	const [bindings, setBindings] = useMapSetting("keyBindings");

	useEffect(() => {
		cmd.storeListMaps().then(setMaps).catch((e) => log.error("[copyToMap] list failed:", e));
	}, []);

	const rows = useMemo(() => {
		const currentId = getCurrentMapId();
		const others = (maps ?? []).filter((m) => m.id !== currentId);
		const lower = filter.toLowerCase();
		const shown = lower ? others.filter((m) => m.name.toLowerCase().includes(lower)) : others;
		const keyOf = (m: MapMeta) => getMapCopyBindingKey(bindings ?? [], m.id);
		return shown.sort((a, b) => {
			const ab = keyOf(a) ? 0 : 1;
			const bb = keyOf(b) ? 0 : 1;
			return ab - bb || a.name.localeCompare(b.name);
		});
	}, [maps, filter, bindings]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent title="Add location to map" className="copy-to-map-modal">
				<p className="copy-to-map-modal__hint">
					Assign a key to a map. Pressing it while a location is open copies that location into
					the map (duplicates are skipped).
				</p>
				<input
					className="input"
					type="text"
					placeholder="Filter maps..."
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					autoFocus
				/>
				<ul className="copy-to-map-modal__list">
					{rows.map((m) => {
						const key = getMapCopyBindingKey(bindings ?? [], m.id) ?? "";
						return (
							<li key={m.id} className="copy-to-map-modal__row">
								<span className="copy-to-map-modal__name">
									{m.name || "(unnamed)"}
									{m.folder && <small> · {m.folder}</small>}
								</span>
								<HotkeyInput
									value={key}
									onChange={(combo) =>
										setBindings(withMapCopyBinding(bindings ?? [], m.id, combo))
									}
								/>
								<button
									type="button"
									className="button"
									disabled={!key}
									onClick={() => setBindings(withMapCopyBinding(bindings ?? [], m.id, ""))}
								>
									Clear
								</button>
							</li>
						);
					})}
					{maps !== null && rows.length === 0 && (
						<li className="copy-to-map-modal__empty">No other maps.</li>
					)}
				</ul>
			</DialogContent>
		</Dialog>
	);
}
