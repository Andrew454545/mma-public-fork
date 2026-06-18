import { describe, it, expect } from "vitest";
import { passesDescriptionSearch, isPanoGood } from "@/plugins/generator/engine/filters";
import { DEFAULT_SETTINGS } from "@/plugins/generator/engine/types";
import type { GeneratorSettings } from "@/plugins/generator/engine/types";

function loc(description = "", shortDescription = ""): google.maps.StreetViewLocation {
	return { description, shortDescription } as unknown as google.maps.StreetViewLocation;
}

function settings(patch: Partial<GeneratorSettings>): GeneratorSettings {
	return { ...DEFAULT_SETTINGS, ...patch };
}

describe("passesDescriptionSearch", () => {
	it("passes everything when disabled or terms empty", () => {
		expect(passesDescriptionSearch(loc("Main Street"), settings({ searchInDescription: false }))).toBe(true);
		expect(
			passesDescriptionSearch(loc("Main Street"), settings({ searchInDescription: true, searchTerms: "  " })),
		).toBe(true);
	});

	it("include + contains keeps matches, drops non-matches", () => {
		const s = settings({ searchInDescription: true, searchTerms: "street", searchMode: "contains" });
		expect(passesDescriptionSearch(loc("Main Street"), s)).toBe(true);
		expect(passesDescriptionSearch(loc("Country Road"), s)).toBe(false);
	});

	it("exclude inverts the match", () => {
		const s = settings({
			searchInDescription: true,
			searchTerms: "street",
			searchMode: "contains",
			searchFilterType: "exclude",
		});
		expect(passesDescriptionSearch(loc("Main Street"), s)).toBe(false);
		expect(passesDescriptionSearch(loc("Country Road"), s)).toBe(true);
	});

	it("matches any of several comma-separated terms", () => {
		const s = settings({ searchInDescription: true, searchTerms: "road, avenue", searchMode: "contains" });
		expect(passesDescriptionSearch(loc("Sunset Avenue"), s)).toBe(true);
		expect(passesDescriptionSearch(loc("Main Street"), s)).toBe(false);
	});

	it("is accent-insensitive", () => {
		const s = settings({ searchInDescription: true, searchTerms: "rua", searchMode: "fullword" });
		expect(passesDescriptionSearch(loc("Rúa do Vilar"), s)).toBe(true);
	});

	it("startswith / endswith operate per word", () => {
		const starts = settings({ searchInDescription: true, searchTerms: "av", searchMode: "startswith" });
		expect(passesDescriptionSearch(loc("Sunset Avenue"), starts)).toBe(true);
		const ends = settings({ searchInDescription: true, searchTerms: "street", searchMode: "endswith" });
		expect(passesDescriptionSearch(loc("Main Street"), ends)).toBe(true);
		expect(passesDescriptionSearch(loc("Streetlight"), ends)).toBe(false);
	});
});

function pano(over: {
	pano?: string;
	links?: number;
	description?: string;
	imageDate?: string;
}): google.maps.StreetViewResolvedPanoramaData {
	const links = Array.from({ length: over.links ?? 2 }, () => ({ heading: 0, pano: "x" }));
	return {
		location: {
			pano: over.pano ?? "a".repeat(22),
			description: over.description ?? "Main Street",
			shortDescription: "",
		},
		links,
		imageDate: over.imageDate ?? "2020-06",
		time: [],
	} as unknown as google.maps.StreetViewResolvedPanoramaData;
}

describe("isPanoGood new filters", () => {
	it("rejects panos outside the links-length range", () => {
		const s = settings({ filterByLinks: true, minLinks: 2, maxLinks: 3, rejectDateless: false });
		expect(isPanoGood(pano({ links: 2 }), s)).toBe(true);
		expect(isPanoGood(pano({ links: 1 }), s)).toBe(false);
		expect(isPanoGood(pano({ links: 4 }), s)).toBe(false);
	});

	it("applies description search as a gate", () => {
		const s = settings({
			searchInDescription: true,
			searchTerms: "bridge",
			searchMode: "contains",
			rejectDateless: false,
			rejectNoDescription: false,
		});
		expect(isPanoGood(pano({ description: "Old Bridge" }), s)).toBe(true);
		expect(isPanoGood(pano({ description: "Main Street" }), s)).toBe(false);
	});
});
