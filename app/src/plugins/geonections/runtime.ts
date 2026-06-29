import { open } from "@tauri-apps/plugin-shell";
import type { Location, LocationPatch_Deserialize, Update } from "@/bindings.gen";
import { waitForGoogleMap } from "@/lib/map/mapState";
import { fetchSvMetadata } from "@/lib/sv/svMeta";
import { toast } from "@/lib/util/toast";
import { createPluginStorage } from "@/plugins/registry";
import { getSettings, setSetting } from "@/store/settings";
import {
	createTags,
	fetchAllLocations,
	fetchLocationsByIds,
	getActiveLocation,
	getCurrentMap,
	getSelectedLocationIds,
	removeLocations,
	selectEverything,
	setActiveLocation,
	updateLocations,
} from "@/store/useMapStore";
import { countryNameForCode, isCountryTag } from "./countries";

export type GeonectionsStatus = {
	message: string;
	busy: boolean;
};

export type GeonectionsSnapshot = {
	modeEnabled: boolean;
	autoplayEnabled: boolean;
	autoplayDelayMs: number;
	status: GeonectionsStatus;
};

export type RoadTagSummary = {
	hasRoad: number;
	noRoad: number;
	skipped: number;
	viaGetMetadata: number;
	viaGetPanorama: number;
};

type RoadResult =
	| { ok: true; hasRoad: boolean; source: "GetMetadata" | "getPanorama" }
	| { ok: false; status?: string };

const storage = createPluginStorage("geonections");
const DISCORD_INVITE = "https://discord.gg/hGjtMhTTFc";
const DIFFICULTY_TAGS = ["Easy", "Medium", "Hard", "Expert"];
const ROAD_TAGS = ["Has road name", "No road name"];
const MODIFIER_INPUTS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

let modeEnabled = storage.get("modeEnabled", false);
let autoplayEnabled = false;
let autoplayDelayMs = storage.get("autoplayDelayMs", 3000);
let autoplayTimer: ReturnType<typeof setInterval> | null = null;
let autoplayBusy = false;
let status: GeonectionsStatus = { message: "Ready", busy: false };
const listeners = new Set<() => void>();
let modePill: HTMLButtonElement | null = null;

function buildSnapshot(): GeonectionsSnapshot {
	return {
		modeEnabled,
		autoplayEnabled,
		autoplayDelayMs,
		status,
	};
}

let snapshot = buildSnapshot();

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function notify() {
	snapshot = buildSnapshot();
	updateModePill();
	for (const listener of listeners) listener();
}

function setStatus(message: string, busy = false) {
	status = { message, busy };
	notify();
}

export function subscribeGeonections(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getGeonectionsSnapshot() {
	return snapshot;
}

export function setGeonectionsMode(enabled: boolean) {
	modeEnabled = enabled;
	storage.set("modeEnabled", enabled);
	if (!enabled) setAutoplayEnabled(false);
	notify();
}

export function setAutoplayDelay(ms: number) {
	autoplayDelayMs = Math.max(1000, Math.min(90000, ms));
	storage.set("autoplayDelayMs", autoplayDelayMs);
	if (autoplayEnabled) restartAutoplay();
	notify();
}

export function setAutoplayEnabled(enabled: boolean) {
	autoplayEnabled = enabled && modeEnabled;
	restartAutoplay();
	notify();
}

function updateModePill() {
	if (!modePill) return;
	let text = modeEnabled ? "Geonections Mode: ON" : "Geonections Mode: Off";
	if (modeEnabled && autoplayEnabled) {
		const seconds = Math.round(autoplayDelayMs / 1000);
		text += seconds >= 60 ? ` · ${seconds / 60}m` : ` · ${seconds}s`;
	}
	modePill.textContent = text;
	modePill.classList.toggle("geonections-pill--on", modeEnabled);
	modePill.setAttribute("aria-pressed", String(modeEnabled));
}

function mountModePill() {
	document.querySelectorAll(".geonections-pill").forEach((el) => el.remove());
	modePill = document.createElement("button");
	modePill.type = "button";
	modePill.className = "geonections-pill";
	modePill.addEventListener("click", () => setGeonectionsMode(!modeEnabled));
	document.body.appendChild(modePill);
	updateModePill();
}

function unmountModePill() {
	modePill?.remove();
	modePill = null;
}

function restartAutoplay() {
	if (autoplayTimer) {
		clearInterval(autoplayTimer);
		autoplayTimer = null;
	}
	if (!autoplayEnabled) return;
	autoplayTimer = setInterval(() => {
		if (autoplayBusy) return;
		autoplayBusy = true;
		navigateRelative(1).finally(() => {
			autoplayBusy = false;
		});
	}, autoplayDelayMs);
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return MODIFIER_INPUTS.has(target.tagName);
}

async function getScopeIds(): Promise<number[]> {
	const selected = Array.from(getSelectedLocationIds());
	if (selected.length > 0) return selected;
	return (await fetchAllLocations()).map((loc) => loc.id);
}

async function getCurrentOrScopeIds(): Promise<number[]> {
	const selected = Array.from(getSelectedLocationIds());
	if (selected.length > 0) return selected;
	const active = getActiveLocation();
	if (active) return [active.id];
	return (await fetchAllLocations()).slice(0, 16).map((loc) => loc.id);
}

async function getScopedLocations(): Promise<Location[]> {
	const selected = Array.from(getSelectedLocationIds());
	if (selected.length > 0) return fetchLocationsByIds(selected);
	return fetchAllLocations();
}

export async function navigateRelative(delta: 1 | -1) {
	const ids = await getScopeIds();
	if (ids.length === 0) {
		toast("No locations to review");
		return;
	}
	const active = getActiveLocation();
	let index = active ? ids.indexOf(active.id) : -1;
	if (index === -1) index = delta > 0 ? -1 : 0;
	const next = ids[(index + delta + ids.length) % ids.length];
	await setActiveLocation(next, false);
}

async function ensureTagIds(names: string[]): Promise<number[]> {
	const cleanNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
	if (cleanNames.length === 0) return [];
	const tags = await createTags(cleanNames);
	const byName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.id]));
	return cleanNames
		.map((name) => byName.get(name.toLowerCase()))
		.filter((id): id is number => typeof id === "number");
}

async function addTagsToLocations(locationIds: number[], tagNames: string[]) {
	if (locationIds.length === 0) return 0;
	const tagIds = await ensureTagIds(tagNames);
	if (tagIds.length === 0 || locationIds.length === 0) return 0;
	const locs = await fetchLocationsByIds(locationIds);
	const updates: Update<LocationPatch_Deserialize>[] = [];
	for (const loc of locs) {
		const next = [...loc.tags];
		for (const tagId of tagIds) {
			if (!next.includes(tagId)) next.push(tagId);
		}
		if (next.length !== loc.tags.length) updates.push({ id: loc.id, patch: { tags: next } });
	}
	if (updates.length) await updateLocations(updates);
	return updates.length;
}

function tagNamesForLocation(loc: Location): string[] {
	const tags = getCurrentMap()?.meta.tags ?? {};
	return loc.tags.map((id) => tags[id]?.name).filter((name): name is string => !!name);
}

function hasDifficultyTag(loc: Location): boolean {
	const tagNames = tagNamesForLocation(loc);
	return tagNames.some((name) => DIFFICULTY_TAGS.includes(name));
}

function hasCountryTag(loc: Location): boolean {
	return tagNamesForLocation(loc).some(isCountryTag);
}

export async function tagCurrent(tagName: string) {
	const active = getActiveLocation();
	if (!active) {
		toast("Open a location first");
		return;
	}
	const count = await addTagsToLocations([active.id], [tagName]);
	toast(count ? `Tagged ${tagName}` : `Already tagged ${tagName}`);
}

export async function tagCurrentCountry() {
	const active = getActiveLocation();
	if (!active) {
		toast("Open a location first");
		return;
	}
	setStatus("Finding country...", true);
	try {
		const country = await getCountryNameForLocation(active);
		if (!country) {
			toast("Country not found");
			setStatus("Country not found");
			return;
		}
		await addTagsToLocations([active.id], [country]);
		toast(`Tagged ${country}`);
		setStatus(`Tagged ${country}`);
	} finally {
		notify();
	}
}

export async function deleteCurrentLocation() {
	const active = getActiveLocation();
	if (!active) {
		toast("Open a location first");
		return;
	}
	const ids = await getScopeIds();
	const index = ids.indexOf(active.id);
	const next = ids.length > 1 ? ids[(index + 1 + ids.length) % ids.length] : null;
	await removeLocations(new Set([active.id]));
	if (next != null && next !== active.id) await setActiveLocation(next, false);
	toast("Deleted location");
}

export async function closeCurrentLocation() {
	await setActiveLocation(null);
}

export async function selectAllLocations() {
	selectEverything();
	toast("Selected all locations");
}

export function toggleFullscreenMap() {
	const next = !getSettings().fullscreenMap;
	setSetting("fullscreenMap", next);
	toast(next ? "Map UI hidden" : "Map UI shown");
}

function googleMapsStreetViewUrl(loc: Location, zoomOverride?: number): string {
	const zoom = zoomOverride ?? loc.zoom ?? 0;
	const fov = (360 / Math.PI) * Math.atan(0.75 * Math.pow(2, 1 - zoom));
	const pitch = (loc.pitch ?? 0) + 90;
	if (loc.panoId) {
		const data = `!3m4!1e1!3m2!1s${encodeURIComponent(loc.panoId)}!2e0`;
		const url = new URL(
			`https://www.google.com/maps/@${loc.lat},${loc.lng},3a,${fov.toFixed(1)}y,${loc.heading.toFixed(2)}h,${pitch.toFixed(2)}t/data=${data}`,
		);
		url.searchParams.set("coh", "235716");
		url.searchParams.set("entry", "tts");
		return url.toString();
	}
	const url = new URL("https://www.google.com/maps/@");
	url.searchParams.set("api", "1");
	url.searchParams.set("map_action", "pano");
	url.searchParams.set("viewpoint", `${loc.lat},${loc.lng}`);
	url.searchParams.set("heading", loc.heading.toFixed(2));
	url.searchParams.set("pitch", loc.pitch.toFixed(2));
	url.searchParams.set("fov", fov.toFixed(1));
	return url.toString();
}

export async function copyCurrentMapsLink() {
	const active = getActiveLocation();
	if (!active) {
		toast("Open a location first");
		return;
	}
	await navigator.clipboard.writeText(googleMapsStreetViewUrl(active));
	toast("Copied Google Maps link");
}

export async function openLocationsInMaps(limit = 16) {
	const ids = await getCurrentOrScopeIds();
	if (ids.length === 0) {
		toast("No locations to open");
		return;
	}
	const locs = await fetchLocationsByIds(ids.slice(0, limit));
	for (const loc of locs) {
		await open(googleMapsStreetViewUrl(loc, 0));
		await delay(80);
	}
	toast(`Opened ${locs.length} Google Maps tab${locs.length === 1 ? "" : "s"}`);
}

function googleMapsGetMetadataPayload(pano: string) {
	const panoType = pano.startsWith("CIHM") || pano.length !== 22 ? 10 : 2;
	return JSON.stringify([
		["apiv3", null, null, null, "US", null, null, null, null, null, [[0]]],
		["en", "US"],
		[[[panoType, pano]]],
		[[1, 2, 3, 4, 8, 6]],
	]);
}

function singleImageSearchPayload(loc: Location) {
	return JSON.stringify([
		["apiv3"],
		[[null, null, loc.lat, loc.lng], 50],
		[null, ["en", "US"], null, null, null, null, null, null, [2], null, [[[2, true, 2]]]],
		[[1, 2, 3, 4, 8, 6]],
	]);
}

function extractRoadFromGetMetadataJson(data: unknown): string | null {
	const root = Array.isArray(data) ? data[1]?.[0] : null;
	const meta = root?.[5]?.[0];
	const road = meta?.[12]?.[0]?.[0]?.[0]?.[2]?.[0];
	return road != null ? String(road) : null;
}

function extractCountryCodeFromRpcJson(data: unknown): string | null {
	const root = Array.isArray(data) ? data[1] : null;
	const inner = Array.isArray(root) && root.length === 3 ? root : root?.[0];
	const code = inner?.[5]?.[0]?.[1]?.[4];
	return typeof code === "string" ? code : null;
}

async function fetchGoogleRpc(
	mode: "GetMetadata" | "SingleImageSearch",
	payload: string,
): Promise<unknown | null> {
	try {
		const response = await fetch(
			`https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/${mode}`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json+protobuf",
					"x-user-agent": "grpc-web-javascript/0.1",
				},
				body: payload,
				mode: "cors",
				credentials: "omit",
			},
		);
		if (!response.ok) return null;
		return response.json();
	} catch {
		return null;
	}
}

export async function getStreetViewRoadForPano(panoId: string): Promise<RoadResult> {
	const id = panoId.trim();
	if (!id) return { ok: false };
	if (id.length === 22) {
		const data = await fetchGoogleRpc("GetMetadata", googleMapsGetMetadataPayload(id));
		if (Array.isArray(data) && data.length > 1) {
			const road = extractRoadFromGetMetadataJson(data);
			return { ok: true, hasRoad: !!road?.trim(), source: "GetMetadata" };
		}
	}

	await waitForGoogleMap();
	return new Promise<RoadResult>((resolve) => {
		const service = new google.maps.StreetViewService();
		service.getPanorama({ pano: id }, (panData, status) => {
			if (status !== google.maps.StreetViewStatus.OK || !panData?.location) {
				resolve({ ok: false, status });
				return;
			}
			const road = panData.location.road;
			resolve({ ok: true, hasRoad: !!road?.trim(), source: "getPanorama" });
		});
	});
}

async function getCountryNameForLocation(loc: Location): Promise<string | null> {
	const code = typeof loc.extra?.countryCode === "string" ? loc.extra.countryCode : null;
	if (code) return countryNameForCode(code);

	if (loc.panoId) {
		const [metadata] = await fetchSvMetadata([loc.panoId]);
		const metadataCode = metadata?.extra?.countryCode;
		if (metadataCode) return countryNameForCode(metadataCode);

		const rpc = await fetchGoogleRpc("GetMetadata", googleMapsGetMetadataPayload(loc.panoId));
		const rpcCode = extractCountryCodeFromRpcJson(rpc);
		if (rpcCode) return countryNameForCode(rpcCode);
	}

	const imageSearch = await fetchGoogleRpc("SingleImageSearch", singleImageSearchPayload(loc));
	const imageSearchCode = extractCountryCodeFromRpcJson(imageSearch);
	return countryNameForCode(imageSearchCode);
}

async function applyGroupedTags(groups: Map<string, number[]>) {
	for (const [tagName, ids] of groups) {
		await addTagsToLocations(ids, [tagName]);
	}
}

export async function tagAllMissingCountries(): Promise<number> {
	const locs = await getScopedLocations();
	const missing = locs.filter((loc) => !hasCountryTag(loc));
	if (missing.length === 0) {
		setStatus("All scoped locations have a country tag");
		toast("All scoped locations have a country tag");
		return 0;
	}

	setStatus(`Tagging countries 0/${missing.length}`, true);
	const groups = new Map<string, number[]>();
	let resolved = 0;
	for (const loc of missing) {
		const country = await getCountryNameForLocation(loc);
		if (country) {
			const ids = groups.get(country) ?? [];
			ids.push(loc.id);
			groups.set(country, ids);
		}
		resolved++;
		if (resolved % 5 === 0 || resolved === missing.length) {
			setStatus(`Tagging countries ${resolved}/${missing.length}`, true);
		}
		await delay(80);
	}
	await applyGroupedTags(groups);
	const tagged = [...groups.values()].reduce((sum, ids) => sum + ids.length, 0);
	setStatus(`Country tagging finished: ${tagged}/${missing.length}`);
	toast(`Tagged ${tagged} countr${tagged === 1 ? "y" : "ies"}`);
	return tagged;
}

export async function tagRoadNamesForScope(): Promise<RoadTagSummary> {
	const locs = (await getScopedLocations()).filter((loc) => !!loc.panoId?.trim());
	if (locs.length === 0) {
		setStatus("No scoped locations have pano IDs");
		toast("No scoped locations have pano IDs");
		return { hasRoad: 0, noRoad: 0, skipped: 0, viaGetMetadata: 0, viaGetPanorama: 0 };
	}

	const groups = new Map<string, number[]>();
	for (const tag of ROAD_TAGS) groups.set(tag, []);
	const summary: RoadTagSummary = {
		hasRoad: 0,
		noRoad: 0,
		skipped: 0,
		viaGetMetadata: 0,
		viaGetPanorama: 0,
	};

	setStatus(`Checking road names 0/${locs.length}`, true);
	for (let i = 0; i < locs.length; i++) {
		const loc = locs[i];
		const result = await getStreetViewRoadForPano(loc.panoId!);
		if (!result.ok) {
			summary.skipped++;
		} else {
			if (result.source === "GetMetadata") summary.viaGetMetadata++;
			else summary.viaGetPanorama++;
			const tag = result.hasRoad ? "Has road name" : "No road name";
			groups.get(tag)!.push(loc.id);
			if (result.hasRoad) summary.hasRoad++;
			else summary.noRoad++;
		}
		if ((i + 1) % 5 === 0 || i === locs.length - 1) {
			setStatus(`Checking road names ${i + 1}/${locs.length}`, true);
		}
		await delay(100);
	}
	await applyGroupedTags(groups);
	setStatus(`Road check done: ${summary.hasRoad} has, ${summary.noRoad} no road`);
	toast(`Road check done: ${summary.hasRoad} has, ${summary.noRoad} no road`);
	return summary;
}

export async function tagMissingPanoIds(): Promise<number> {
	const locs = await getScopedLocations();
	const ids = locs.filter((loc) => !loc.panoId?.trim()).map((loc) => loc.id);
	const tagged = await addTagsToLocations(ids, ["Missing pano ID"]);
	setStatus(tagged ? `Tagged ${tagged} missing pano ID` : "All scoped locations have pano IDs");
	toast(tagged ? `Tagged ${tagged} missing pano ID` : "All scoped locations have pano IDs");
	return tagged;
}

export async function tagMissingDifficulty(): Promise<number> {
	const locs = await getScopedLocations();
	const ids = locs.filter((loc) => !hasDifficultyTag(loc)).map((loc) => loc.id);
	const tagged = await addTagsToLocations(ids, ["Missing difficulty"]);
	setStatus(
		tagged ? `Tagged ${tagged} missing difficulty` : "All scoped locations have difficulty tags",
	);
	toast(
		tagged ? `Tagged ${tagged} missing difficulty` : "All scoped locations have difficulty tags",
	);
	return tagged;
}

export async function tagMissingCountry(): Promise<number> {
	const locs = await getScopedLocations();
	const ids = locs.filter((loc) => !hasCountryTag(loc)).map((loc) => loc.id);
	const tagged = await addTagsToLocations(ids, ["Missing country"]);
	setStatus(tagged ? `Tagged ${tagged} missing country` : "All scoped locations have country tags");
	toast(tagged ? `Tagged ${tagged} missing country` : "All scoped locations have country tags");
	return tagged;
}

export async function checkCountryDifficultyConsistency(): Promise<string> {
	const locs = await getScopedLocations();
	const byCountry = new Map<string, Set<string>>();
	for (const loc of locs) {
		const tagNames = tagNamesForLocation(loc);
		const country = tagNames.find(isCountryTag);
		const difficulty = tagNames.find((tag) => DIFFICULTY_TAGS.includes(tag));
		if (!country || !difficulty) continue;
		const set = byCountry.get(country) ?? new Set<string>();
		set.add(difficulty);
		byCountry.set(country, set);
	}
	const inconsistent = [...byCountry.entries()]
		.filter(([, tags]) => tags.size > 1)
		.map(([country, tags]) => `${country}: ${[...tags].sort().join(", ")}`);
	const message = inconsistent.length
		? `Mixed difficulty tags: ${inconsistent.join("; ")}`
		: "All countries have consistent difficulty tags";
	setStatus(message);
	toast(message, inconsistent.length ? 6000 : 2500);
	return message;
}

function updateDelayFromKey(event: KeyboardEvent): boolean {
	const key = event.key;
	if (event.shiftKey) {
		if (/^[2-9]$/.test(key)) {
			setAutoplayDelay(Number(key) * 10000);
			return true;
		}
		if (key === "!") {
			setAutoplayDelay(15000);
			return true;
		}
		if (key === ")") {
			setAutoplayDelay(60000);
			return true;
		}
		return false;
	}
	if (/^[1-9]$/.test(key)) {
		setAutoplayDelay(Number(key) * 1000);
		return true;
	}
	if (key === "0") {
		setAutoplayDelay(10000);
		return true;
	}
	if (key === "-") {
		setAutoplayDelay(15000);
		return true;
	}
	if (key === "=") {
		setAutoplayDelay(30000);
		return true;
	}
	if (key === "]") {
		setAutoplayDelay(60000);
		return true;
	}
	return false;
}

export function activateGeonectionsRuntime(): () => void {
	mountModePill();
	const onKeyDown = (event: KeyboardEvent) => {
		if (!modeEnabled || isEditableTarget(event.target)) return;
		// Command shortcuts are registered with the app, so they appear in both the
		// command palette and shortcut settings. Delay keys are intentionally dynamic:
		// while autoplay is running, 1-9 and the shifted variants choose its interval.
		if (
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			autoplayEnabled &&
			updateDelayFromKey(event)
		) {
			toast(`Autoplay delay ${Math.round(autoplayDelayMs / 1000)}s`);
			event.preventDefault();
			event.stopPropagation();
		}
	};
	window.addEventListener("keydown", onKeyDown, true);
	return () => {
		window.removeEventListener("keydown", onKeyDown, true);
		setAutoplayEnabled(false);
		unmountModePill();
	};
}

export function openDiscord() {
	void open(DISCORD_INVITE);
}
