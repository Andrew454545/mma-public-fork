import { useCallback } from "react";
import { selectPolygon } from "@/store/useMapStore";
import { getSettings } from "@/store/settings";
import { cmd } from "@/lib/commands";
import { useHeldHotkeyClick } from "@/lib/map/useHeldHotkeyClick";

export function useCountrySelect() {
	useHeldHotkeyClick(
		"countrySelect",
		useCallback((lat, lng, shiftKey) => {
			const { borderDetail, subdivisionDetail } = getSettings();
			const level = shiftKey && subdivisionDetail !== "off" ? subdivisionDetail : borderDetail;
			void (async () => {
				const geometry = await cmd.borderLookup(lat, lng, level);
				if (geometry) selectPolygon(geometry, false);
			})();
		}, []),
		{ ignoreShift: true },
	);
}
