const { registerPlugin } = window.MMA;
import { setClickInterceptor } from "@/lib/map/mapState";
import { selectPolygon } from "@/store/useMapStore";
import { pointInPolygon } from "@/lib/geo/geo";
import { mdiMapSearchOutline } from "@mdi/js";

interface BorderFeature {
	type: "Feature";
	properties: { name: string; code?: string };
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

interface BordersData {
	type: "FeatureCollection";
	features: BorderFeature[];
}

let borders: BordersData | null = null;

async function loadBorders(): Promise<BordersData> {
	if (borders) return borders;
	const res = await fetch("/borders.json");
	borders = await res.json();
	return borders!;
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
		selectPolygon({ coordinates: country.geometry.coordinates, properties: { name, code } }, false);
	} else {
		const [first, ...rest] = country.geometry.coordinates;
		selectPolygon(
			{
				coordinates: first,
				extraPolygons: rest.length > 0 ? rest : undefined,
				properties: { name, code },
			},
			false,
		);
	}
}

const HOLD_KEY = "q";

registerPlugin({
	id: "country-select",
	name: "Country templates",
	description: "Hotkey and click the map to select all locations in a country",
	icon: mdiMapSearchOutline,

	activate() {
		let held = false;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() === HOLD_KEY && !e.repeat && !isEditable(e.target)) {
				held = true;
				document.body.style.cursor = "crosshair";
			}
		};

		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() === HOLD_KEY) {
				held = false;
				document.body.style.cursor = "";
			}
		};

		const interceptor = (lat: number, lng: number): boolean => {
			if (!held) return false;
			loadBorders().then((data) => {
				const country = findCountry(lat, lng, data.features);
				if (country) selectCountry(country);
			});
			return true;
		};

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		setClickInterceptor(interceptor);

		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			setClickInterceptor(null);
			document.body.style.cursor = "";
		};
	},
});

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
