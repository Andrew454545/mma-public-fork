export const fmt = new Intl.NumberFormat("en");
export const dateFmt = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "short",
});
export const shortDateFmt = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(iso: string): string {
	const delta = Date.now() - new Date(iso).getTime();
	if (delta < MINUTE) return "just now";
	if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
	if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
	if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
	return shortDateFmt.format(new Date(iso));
}
