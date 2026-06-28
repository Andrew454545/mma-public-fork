import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAPTERS, type ChapterBody } from "@/components/manual/chapters";
import { MANUAL_COMPONENTS } from "@/components/manual/components";
import { rankChapters, type ChapterText, type ManualHit } from "@/components/manual/searchRank";

export type { ManualHit } from "@/components/manual/searchRank";

// Render a compiled chapter to its visible text so it can be indexed -- the same prose,
// cross-reference titles, and captions the reader sees, with no fragile source scraping.
function chapterText(Body: ChapterBody): string {
	return renderToStaticMarkup(createElement(Body, { components: MANUAL_COMPONENTS }))
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

let index: ChapterText[] | null = null;

export function searchManual(query: string, limit = 8): ManualHit[] {
	if (!index) {
		index = CHAPTERS.map((c) => ({ id: c.id, title: c.title, text: chapterText(c.Body) }));
	}
	return rankChapters(query, index, limit);
}
