export interface ChapterText {
	id: string;
	title: string;
	text: string;
}

export interface ManualHit {
	id: string;
	title: string;
	snippet: string;
}

// A short excerpt of `text` centered on the earliest matched term.
export function makeSnippet(text: string, lowerText: string, terms: string[]): string {
	let pos = -1;
	for (const t of terms) {
		const i = lowerText.indexOf(t);
		if (i !== -1 && (pos === -1 || i < pos)) pos = i;
	}
	if (pos === -1) return text.slice(0, 120).trim() + (text.length > 120 ? "…" : "");
	const start = Math.max(0, pos - 50);
	const end = Math.min(text.length, pos + 90);
	let s = text.slice(start, end).trim();
	if (start > 0) s = "…" + s;
	if (end < text.length) s = s + "…";
	return s;
}

// Search every chapter's title and body. All whitespace-separated terms must be present.
// Title matches rank above body-only matches. Returns up to `limit` hits.
export function rankChapters(query: string, index: ChapterText[], limit = 8): ManualHit[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const terms = q.split(/\s+/);
	const scored: { hit: ManualHit; score: number }[] = [];
	for (const ch of index) {
		const titleLc = ch.title.toLowerCase();
		const textLc = ch.text.toLowerCase();
		const haystack = titleLc + " " + textLc;
		if (!terms.every((t) => haystack.includes(t))) continue;
		const titleHit = titleLc.includes(q);
		const score = (titleHit ? 0 : 100) + (textLc.includes(q) ? 0 : 10);
		scored.push({
			hit: { id: ch.id, title: ch.title, snippet: makeSnippet(ch.text, textLc, terms) },
			score,
		});
	}
	scored.sort((a, b) => a.score - b.score);
	return scored.slice(0, limit).map((s) => s.hit);
}
