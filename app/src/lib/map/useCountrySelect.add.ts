import { useEffect } from "react";
import { setClickInterceptor } from "@/lib/map/mapState";
import { selectPolygon } from "@/store/useMapStore";
import { pointInPolygon } from "@/lib/geo/geo";
import { getBinding } from "@/lib/util/hotkeys.add";
import { parseHotkey, matchesKey, isEditableElement } from "@/lib/hooks/useHotkey";
import { getSettings, type BorderDetail } from "@/store/settings.add";

interface BorderFeature {
	type: "Feature";
	properties: { name: string; code?: string };
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

interface BordersData {
	type: "FeatureCollection";
	features: BorderFeature[];
}

const borderCache = new Map<string, BordersData>();

async function loadBorders(level: BorderDetail): Promise<BordersData> {
	const cached = borderCache.get(level);
	if (cached) return cached;

	let data: BordersData;
	if (level === "light") {
		const res = await fetch("/borders.json");
		data = await res.json();
	} else {
		const { cmd } = await import("@/lib/commands");
		const appDataDir = await cmd.getAppDataDir();
		const sep = appDataDir.includes("\\") ? "\\" : "/";
		const path = `${appDataDir}${sep}borders${sep}borders-${level}.json`;
		const raw = await cmd.readFile(path);
		data = JSON.parse(raw);
	}

	borderCache.set(level, data);
	return data;
}

function findCountry(lat: number, lng: number, features: BorderFeature[]): BorderFeature | null {
	for (const f of features) {
		if (f.geometry.type === "Polygon") {
			if (pointInPolygon(lng, lat, f.geometry.coordinates)) return f;
		} else {
			for (const poly of f.geometry.coordinates) {
				if (pointInPolygon(lng, lat, poly)) return f;
			}
		}
	}
	return null;
}

function selectCountry(country: BorderFeature) {
	const { name, code } = country.properties;
	if (country.geometry.type === "Polygon") {
		selectPolygon({ coordinates: country.geometry.coordinates as [number, number][][], properties: { name, code } }, false);
	} else {
		const [first, ...rest] = country.geometry.coordinates;
		selectPolygon(
			{
				coordinates: first as [number, number][][],
				extraPolygons: rest.length > 0 ? (rest as [number, number][][][]) : null,
				properties: { name, code },
			},
			false,
		);
	}
}

export function useCountrySelect() {
	useEffect(() => {
		let held = false;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat || isEditableElement(e.target)) return;
			const binding = getBinding("countrySelect");
			if (!binding) return;
			const parsed = parseHotkey(binding);
			for (const alt of parsed) {
				if (alt.length === 1 && matchesKey(e, alt[0])) {
					held = true;
					document.body.style.cursor = "crosshair";
					return;
				}
			}
		};

		const onKeyUp = (e: KeyboardEvent) => {
			if (!held) return;
			const binding = getBinding("countrySelect");
			if (!binding) return;
			const parsed = parseHotkey(binding);
			for (const alt of parsed) {
				if (alt.length === 1 && e.key.toLowerCase() === alt[0].key) {
					held = false;
					document.body.style.cursor = "";
					return;
				}
			}
		};

		const onBlur = () => {
			if (held) {
				held = false;
				document.body.style.cursor = "";
			}
		};

		const interceptor = (lat: number, lng: number): boolean => {
			if (!held) return false;
			const { borderDetail } = getSettings();
			loadBorders(borderDetail)
				.catch(() => loadBorders("light"))
				.then((data) => {
					const country = findCountry(lat, lng, data.features);
					if (country) selectCountry(country);
				});
			return true;
		};

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		setClickInterceptor(interceptor);

		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			setClickInterceptor(null);
			document.body.style.cursor = "";
		};
	}, []);
}
