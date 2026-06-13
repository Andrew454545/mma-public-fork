import { useCallback } from "react";
import { getSelections, removeSelections } from "@/store/useMapStore";
import { polygonSelectionsContaining } from "@/store/selections";
import { useHeldHotkeyClick } from "@/lib/map/useHeldHotkeyClick";

export function useDeletePolygon() {
	useHeldHotkeyClick(
		"deletePolygon",
		useCallback((lat, lng) => {
			const keys = polygonSelectionsContaining(getSelections(), lat, lng);
			if (keys.length) void removeSelections(keys);
		}, []),
	);
}
