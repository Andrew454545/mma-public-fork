import { describe, it, expect } from "vitest";
import { rankChapters, makeSnippet, type ChapterText } from "@/components/manual/searchRank";

const index: ChapterText[] = [
	{ id: "tags", title: "Tags", text: "group locations with quicktags" },
	{ id: "sel", title: "Selection", text: "pick locations" },
	{ id: "other", title: "Other", text: "a selection of tools and quicktags" },
];

describe("rankChapters", () => {
	it("returns nothing for an empty query", () => {
		expect(rankChapters("", index)).toEqual([]);
		expect(rankChapters("   ", index)).toEqual([]);
	});

	it("finds a chapter by body text", () => {
		expect(rankChapters("quicktags", index).map((h) => h.id)).toContain("tags");
	});

	it("ranks a title match above a body-only match", () => {
		const hits = rankChapters("selection", index);
		expect(hits[0].id).toBe("sel");
	});

	it("requires every term to be present (AND)", () => {
		expect(rankChapters("selection zzznotaword", index)).toEqual([]);
	});

	it("matches case-insensitively", () => {
		expect(rankChapters("TAGS", index).length).toBeGreaterThan(0);
	});

	it("respects the result limit", () => {
		const many: ChapterText[] = [
			{ id: "a", title: "A", text: "the road" },
			{ id: "b", title: "B", text: "the river" },
			{ id: "c", title: "C", text: "the hill" },
		];
		expect(rankChapters("the", many, 2).length).toBe(2);
	});
});

describe("makeSnippet", () => {
	it("centers the excerpt on the matched term", () => {
		const text = "lorem ipsum dolor sit amet perfect score consectetur adipiscing elit done";
		const snip = makeSnippet(text, text.toLowerCase(), ["perfect"]);
		expect(snip.toLowerCase()).toContain("perfect");
	});

	it("falls back to the start of the text when no term matches", () => {
		const text = "alpha beta gamma";
		expect(makeSnippet(text, text.toLowerCase(), ["zzz"])).toBe("alpha beta gamma");
	});
});
