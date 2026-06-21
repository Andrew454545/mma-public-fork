export type CommandGroup = "Map" | "Selections" | "Bulk Operations" | "Tags";

export interface Command {
	id: string;
	label: string;
	icon?: string;
	group: CommandGroup;
	defaultBinding?: string;
	execute: () => void;
	enabled?: () => boolean;
}

const commands: Command[] = [];

export function registerCommand(cmd: Command): void {
	commands.push(cmd);
}

export function getCommands(): readonly Command[] {
	return commands;
}

export function getCommand(id: string): Command | undefined {
	return commands.find((c) => c.id === id);
}

import { getSettings, setSetting } from "./settings";

export function togglePinnedCommand(id: string): void {
	const pinned = [...getSettings().pinnedCommands];
	const idx = pinned.indexOf(id);
	if (idx >= 0) {
		pinned.splice(idx, 1);
	} else {
		pinned.push(id);
	}
	setSetting("pinnedCommands", pinned);
}

export function movePinnedCommand(index: number, direction: -1 | 1): void {
	const pinned = [...getSettings().pinnedCommands];
	const target = index + direction;
	if (target < 0 || target >= pinned.length) return;
	[pinned[index], pinned[target]] = [pinned[target], pinned[index]];
	setSetting("pinnedCommands", pinned);
}

export function removePinnedAt(index: number): void {
	const pinned = [...getSettings().pinnedCommands];
	pinned.splice(index, 1);
	setSetting("pinnedCommands", pinned);
}

export function insertSeparator(index: number, position: "before" | "after"): void {
	const pinned = [...getSettings().pinnedCommands];
	pinned.splice(position === "before" ? index : index + 1, 0, "---");
	setSetting("pinnedCommands", pinned);
}

export function reorderPinned(fromIndex: number, toIndex: number): void {
	const pinned = [...getSettings().pinnedCommands];
	const [item] = pinned.splice(fromIndex, 1);
	pinned.splice(toIndex, 0, item);
	setSetting("pinnedCommands", pinned);
}
