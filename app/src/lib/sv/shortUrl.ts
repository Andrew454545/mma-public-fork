import { schemeBase } from "@/lib/util/util";

// Routed through the Tauri `gmaps` URI-scheme handler (server-side proxy to
// www.google.com), so it works in dev and release.
const BATCH_URL = `${schemeBase("gmaps")}maps/_/MapsWizUi/data/batchexecute`;

export async function shortenMapsUrl(longUrl: string): Promise<string> {
	const innerPayload = JSON.stringify([
		longUrl,
		[null, null, null, null, null, null, 81],
		null,
		null,
		null,
		1,
	]);
	const outerPayload = JSON.stringify([
		[["/MapsUrlService.CreateShortUrl", innerPayload, null, "generic"]],
	]);

	const params = new URLSearchParams({
		rpcids: "ExM4R",
		"source-path": new URL(longUrl).pathname + new URL(longUrl).search,
		hl: "en",
	});
	const body = new URLSearchParams({ "f.req": outerPayload });
	const res = await fetch(`${BATCH_URL}?${params}`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
		body,
		mode: "cors",
		credentials: "omit",
	});

	if (!res.ok) return longUrl;

	const text = await res.text();
	const lines = text.split("\n").filter((l) => l.startsWith("["));
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			const inner = parsed?.[0]?.[2];
			if (typeof inner === "string") {
				const result = JSON.parse(inner);
				if (typeof result?.[0] === "string" && result[0].startsWith("http")) {
					return result[0];
				}
			}
		} catch {
			// ignored
		}
	}

	return longUrl;
}
