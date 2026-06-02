import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { log } from "@/lib/util/log";

// The manual always lives in the main window, never the editor window that asked
// for it. Focus main and tell it to open (optionally at a specific chapter).
export async function openManualInMain(chapterId?: string): Promise<void> {
	const main = await WebviewWindow.getByLabel("main");
	if (main) {
		if (await main.isMinimized()) await main.unminimize();
		await main.setFocus();
	}
	await emitTo("main", "open-manual", chapterId ?? null);
}

export async function openMapWindow(id: string, name: string): Promise<void> {
	const label = `map-${id}`;
	const existing = await WebviewWindow.getByLabel(label);
	if (existing) {
		if (await existing.isMinimized()) await existing.unminimize();
		await existing.setFocus();
		return;
	}

	const win = new WebviewWindow(label, {
		url: `#map/${id}`,
		title: name || "Map Editor",
		width: 1400,
		height: 900,
		resizable: true,
		visible: false,
		zoomHotkeysEnabled: true,
		backgroundColor: "#252521",
	});

	win.once("tauri://error", (e) => {
		log.error("Failed to create map window:", e);
	});
}
