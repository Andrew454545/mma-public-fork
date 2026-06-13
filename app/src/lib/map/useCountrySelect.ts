import { useCallback } from "react";
import { selectPolygon } from "@/store/useMapStore";
import { getSettings } from "@/store/settings";
import { cmd } from "@/lib/commands";
import { useHeldHotkeyClick } from "@/lib/map/useHeldHotkeyClick";

export function useCountrySelect() {
	useHeldHotkeyClick(
		"countrySelect",
		useCallback((lat, lng) => {
			const { borderDetail } = getSettings();
			void (async () => {
				const geometry = await cmd.borderLookup(lat, lng, borderDetail);
				if (geometry) selectPolygon(geometry, false);
			})();
		}, []),
	);
}
