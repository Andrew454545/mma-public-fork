import type { ComponentType } from "react";
import { createSyncStore } from "@/lib/util/syncStore";
import { runAsPlugin, disposePlugin } from "@/plugins/scope";

export interface PluginSettingDef {
	key: string;
	label: string;
	type: "boolean" | "string" | "number";
	default: unknown;
}

export interface Plugin {
	id: string;
	name: string;
	description?: string;
	icon: string;
	comingSoon?: boolean;
	core?: boolean;
	settings?: PluginSettingDef[];
	activate(): void | (() => void);
	modal?: ComponentType<{ onClose: () => void }>;
	sidebar?: ComponentType<{ onClose: () => void }>;
	locationPanel?: ComponentType;
}

export interface PluginManifest {
	id: string;
	name: string;
	description: string;
	icon: string;
	main: string;
}

export type PluginBehavior = Partial<Plugin> & {
	activate(): void | (() => void);
};

// --- Registry ---

const plugins = new Map<string, Plugin>();
const cleanups = new Map<string, () => void>();
let pendingManifest: PluginManifest | null = null;

export function setPendingManifest(manifest: PluginManifest | null) {
	pendingManifest = manifest;
}

const ENABLED_KEY = "mma_plugins_enabled";
function loadEnabled(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(ENABLED_KEY) || "[]"));
	} catch {
		return new Set();
	}
}

function saveEnabled(set: Set<string>) {
	localStorage.setItem(ENABLED_KEY, JSON.stringify([...set]));
}

const enabledSet = loadEnabled();

export function registerPlugin(plugin: Plugin | PluginBehavior) {
	if (pendingManifest) {
		const merged: Plugin = {
			id: pendingManifest.id,
			name: pendingManifest.name,
			description: pendingManifest.description || undefined,
			icon: pendingManifest.icon,
			...plugin,
		};
		plugins.set(merged.id, merged);
		pendingManifest = null;
	} else {
		plugins.set((plugin as Plugin).id, plugin as Plugin);
	}
	notifyRegistry();
}

export function getPlugins(): Plugin[] {
	return [...plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getPlugin(id: string): Plugin | undefined {
	return plugins.get(id);
}

export function unregisterPlugin(id: string) {
	plugins.delete(id);
	notifyRegistry();
}

export function isPluginEnabled(id: string): boolean {
	return enabledSet.has(id);
}

export function setPluginEnabled(id: string, enabled: boolean) {
	if (enabled) enabledSet.add(id);
	else enabledSet.delete(id);
	saveEnabled(enabledSet);
	notifyRegistry();
}

export function getEnabledPlugins(): Plugin[] {
	return [...plugins.values()].filter((p) => enabledSet.has(p.id));
}

// --- Plugin storage (namespaced localStorage, one JSON object per plugin) ---

export interface PluginStorage {
	get<T = unknown>(key: string, fallback?: T): T;
	set(key: string, value: unknown): void;
	remove(key: string): void;
	keys(): string[];
}

function pluginStoreKey(id: string): string {
	return `mma_plugin:${id}`;
}

function readPluginStore(id: string): Record<string, unknown> {
	try {
		return JSON.parse(localStorage.getItem(pluginStoreKey(id)) || "{}");
	} catch {
		return {};
	}
}

function writePluginStore(id: string, data: Record<string, unknown>) {
	localStorage.setItem(pluginStoreKey(id), JSON.stringify(data));
}

export function createPluginStorage(id: string): PluginStorage {
	return {
		get<T = unknown>(key: string, fallback?: T): T {
			const data = readPluginStore(id);
			return (key in data ? data[key] : fallback) as T;
		},
		set(key, value) {
			const data = readPluginStore(id);
			data[key] = value;
			writePluginStore(id, data);
		},
		remove(key) {
			const data = readPluginStore(id);
			delete data[key];
			writePluginStore(id, data);
		},
		keys() {
			return Object.keys(readPluginStore(id));
		},
	};
}

// Declarative settings (Plugin.settings) are backed by the same namespaced store,
// falling back to each def's `default` when unset.
export function getPluginSetting<T = unknown>(plugin: Plugin, key: string): T {
	const data = readPluginStore(plugin.id);
	if (key in data) return data[key] as T;
	return plugin.settings?.find((s) => s.key === key)?.default as T;
}

export function setPluginSetting(id: string, key: string, value: unknown) {
	createPluginStorage(id).set(key, value);
	notifyRegistry();
}

// --- Activation lifecycle ---

export function activatePlugins() {
	for (const plugin of getEnabledPlugins()) {
		if (!cleanups.has(plugin.id)) {
			const cleanup = runAsPlugin(plugin.id, () => plugin.activate());
			if (cleanup) cleanups.set(plugin.id, cleanup);
		}
	}
	notifyRegistry();
}

export function deactivatePlugins() {
	for (const [_id, cleanup] of cleanups) {
		cleanup();
	}
	cleanups.clear();
}

export function activatePlugin(id: string) {
	const plugin = plugins.get(id);
	if (!plugin || cleanups.has(id)) return;
	const cleanup = runAsPlugin(id, () => plugin.activate());
	if (cleanup) cleanups.set(id, cleanup);
}

export function deactivatePlugin(id: string) {
	const cleanup = cleanups.get(id);
	if (cleanup) {
		cleanup();
		cleanups.delete(id);
	}
	// Reverse every host registration the plugin made during activation, even when it
	// returned no cleanup — so a disabled plugin's providers/fields/listeners stop.
	disposePlugin(id);
}

// --- React subscription for registry changes ---

const {
	subscribe: subscribeRegistry,
	getSnapshot: getRegistrySnapshot,
	notify: notifyRegistry,
} = createSyncStore();
export { subscribeRegistry, getRegistrySnapshot };
