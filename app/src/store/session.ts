// Browser-style session restore. The session is snapshotted at a single point:
// when the main (list) window closes (see main.tsx). We record which map windows
// existed at that instant and reopen them on next launch. A map window closed
// individually is already gone by the time the main window closes, so it isn't
// remembered - matching how a browser restores tabs open at quit but not ones you
// closed yourself. Stored in localStorage (shared across all same-origin windows).

const KEY = "openMapSession";

export function loadSession(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

export function saveSession(ids: string[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(ids));
	} catch {
		// ignored
	}
}
