const { registerPlugin } = window.MMA;
import { mdiMapMarkerCheck } from "@mdi/js";
import { isPluginEnabled, setPluginEnabled } from "@/plugins/registry";
import { registerCommand } from "@/store/commands";
import { GeonectionsSidebar } from "./GeonectionsSidebar";
import {
	activateGeonectionsRuntime,
	checkCountryDifficultyConsistency,
	closeCurrentLocation,
	copyCurrentMapsLink,
	deleteCurrentLocation,
	getGeonectionsSnapshot,
	navigateRelative,
	openDiscord,
	openLocationsInMaps,
	selectAllLocations,
	setAutoplayEnabled,
	setGeonectionsMode,
	tagAllMissingCountries,
	tagCurrent,
	tagCurrentCountry,
	tagMissingCountry,
	tagMissingDifficulty,
	tagMissingPanoIds,
	tagRoadNamesForScope,
	toggleFullscreenMap,
} from "./runtime";

function isModeActive() {
	return isPluginEnabled("geonections") && getGeonectionsSnapshot().modeEnabled;
}

function registerGeonectionsCommands() {
	registerCommand({
		id: "geonections-toggle-mode",
		label: "Toggle Geonections Mode",
		group: "Geonections",
		execute: () => setGeonectionsMode(!getGeonectionsSnapshot().modeEnabled),
		enabled: () => isPluginEnabled("geonections"),
	});
	registerCommand({
		id: "geonections-previous-location",
		label: "Geonections: Previous location",
		group: "Geonections",
		defaultBinding: "ArrowLeft",
		execute: () => void navigateRelative(-1),
		enabled: isModeActive,
	});
	registerCommand({
		id: "geonections-next-location",
		label: "Geonections: Next location",
		group: "Geonections",
		defaultBinding: "g, ArrowRight",
		execute: () => void navigateRelative(1),
		enabled: isModeActive,
	});
	registerCommand({
		id: "geonections-toggle-autoplay",
		label: "Geonections: Toggle autoplay",
		group: "Geonections",
		defaultBinding: "space",
		execute: () => setAutoplayEnabled(!getGeonectionsSnapshot().autoplayEnabled),
		enabled: isModeActive,
	});

	for (const [id, label, tag, binding] of [
		["easy", "Easy", "Easy", "1"],
		["medium", "Medium", "Medium", "2"],
		["hard", "Hard", "Hard", "3"],
		["expert", "Expert", "Expert", "4"],
	] as const) {
		registerCommand({
			id: `geonections-tag-${id}`,
			label: `Geonections: Tag ${label}`,
			group: "Geonections",
			defaultBinding: binding,
			execute: () => void tagCurrent(tag),
			// Number keys select autoplay timing while autoplay is running.
			enabled: () => isModeActive() && !getGeonectionsSnapshot().autoplayEnabled,
		});
	}

	for (const command of [
		{
			id: "geonections-tag-country",
			label: "Geonections: Tag current country",
			defaultBinding: "t",
			execute: () => void tagCurrentCountry(),
		},
		{
			id: "geonections-toggle-ui",
			label: "Geonections: Toggle map UI",
			defaultBinding: "h",
			execute: toggleFullscreenMap,
		},
		{
			id: "geonections-delete-location",
			label: "Geonections: Delete current location",
			defaultBinding: "c",
			execute: () => void deleteCurrentLocation(),
		},
		{
			id: "geonections-open-maps",
			label: "Geonections: Open 16 locations in Google Maps",
			defaultBinding: "o",
			execute: () => void openLocationsInMaps(16),
		},
		{
			id: "geonections-tag-usable",
			label: "Geonections: Tag Usable",
			defaultBinding: "u",
			execute: () => void tagCurrent("Usable"),
		},
		{
			id: "geonections-select-all",
			label: "Geonections: Select all locations",
			defaultBinding: "a",
			execute: () => void selectAllLocations(),
		},
		{
			id: "geonections-close-location",
			label: "Geonections: Close current location",
			defaultBinding: "s",
			execute: () => void closeCurrentLocation(),
		},
		{
			id: "geonections-copy-maps-link",
			label: "Geonections: Copy Google Maps link",
			defaultBinding: "Mod+c",
			execute: () => void copyCurrentMapsLink(),
		},
		{
			id: "geonections-find-missing-pano",
			label: "Geonections: Find missing pano ID",
			execute: () => void tagMissingPanoIds(),
		},
		{
			id: "geonections-tag-road-names",
			label: "Geonections: Tag road names",
			execute: () => void tagRoadNamesForScope(),
		},
		{
			id: "geonections-find-missing-difficulty",
			label: "Geonections: Find missing difficulty",
			execute: () => void tagMissingDifficulty(),
		},
		{
			id: "geonections-find-missing-country",
			label: "Geonections: Find missing country",
			execute: () => void tagMissingCountry(),
		},
		{
			id: "geonections-check-tags",
			label: "Geonections: Check country and difficulty tags",
			execute: () => void checkCountryDifficultyConsistency(),
		},
		{
			id: "geonections-tag-all-countries",
			label: "Geonections: Tag all missing countries",
			execute: () => void tagAllMissingCountries(),
		},
		{
			id: "geonections-submit-discord",
			label: "Geonections: Submit to Discord",
			execute: openDiscord,
		},
	] as const) {
		registerCommand({ ...command, group: "Geonections", enabled: isModeActive });
	}
}

registerGeonectionsCommands();

registerPlugin({
	id: "geonections",
	name: "Geonections",
	description: "Review, tag, and final-check Geonections maps",
	icon: mdiMapMarkerCheck,
	activate() {
		return activateGeonectionsRuntime();
	},
	sidebar: GeonectionsSidebar,
});

if (!isPluginEnabled("geonections")) setPluginEnabled("geonections", true);
