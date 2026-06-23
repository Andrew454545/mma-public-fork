import { useCallback } from "react";
import { getAllSelections, removeSelections } from "@/store/useMapStore";
import { polygonSelectionsContaining } from "@/store/selections";
import { useHeldHotkeyClick } from "@/lib/map/useHeldHotkeyClick";

export function useDeletePolygon() {
	useHeldHotkeyClick(
		"deletePolygon",
		useCallback((lat, lng) => {
			const keys = polygonSelectionsContaining(getAllSelections(), lat, lng);
			if (keys.length) void removeSelections(keys);
		}, []),
	);
}
