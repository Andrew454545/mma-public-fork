import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { Icon } from "@/components/primitives/Icon";
import {
	getPlugins,
	isPluginEnabled,
	setPluginEnabled,
	activatePlugin,
	deactivatePlugin,
	unregisterPlugin,
} from "@/plugins/registry";
import type { Plugin, PluginManifest } from "@/plugins/registry";
import { loadAndActivatePlugin } from "@/plugins/index";
import { cmd } from "@/lib/commands";
import { log } from "@/lib/util/log";

const REGISTRY_URL = "https://raw.githubusercontent.com/ccmdi/mma/master/plugins/registry.json";

interface RegistryEntry {
	id: string;
	name: string;
	description: string;
	icon: string;
	version: string;
	main: string;
}

type Tab = "core" | "additional";

let registryCache: RegistryEntry[] | null = null;

function CoreCard({ plugin }: { plugin: Plugin }) {
	const [enabled, setEnabled] = useState(() => isPluginEnabled(plugin.id));

	const toggle = () => {
		if (plugin.comingSoon) return;
		const next = !enabled;
		setPluginEnabled(plugin.id, next);
		if (next) activatePlugin(plugin.id);
		else deactivatePlugin(plugin.id);
		setEnabled(next);
	};

	return (
		<div
			className={`plugin-card ${enabled ? "plugin-card--enabled" : ""} ${plugin.comingSoon ? "plugin-card--coming-soon" : ""}`}
		>
			<div className="plugin-card__icon">
				<Icon path={plugin.icon} size={32} />
			</div>
			<div className="plugin-card__info">
				<div className="plugin-card__name">{plugin.name}</div>
				{plugin.description && <div className="plugin-card__desc">{plugin.description}</div>}
			</div>
			{!plugin.comingSoon && (
				<button
					className={`button plugin-card__toggle ${enabled ? "button--danger" : "button--primary"}`}
					onClick={toggle}
				>
					{enabled ? "Disable" : "Enable"}
				</button>
			)}
		</div>
	);
}

function AdditionalCard({
	entry,
	installed,
	onInstall,
	onUninstall,
}: {
	entry: RegistryEntry;
	installed: boolean;
	onInstall: (id: string) => void;
	onUninstall: (id: string) => void;
}) {
	const [busy, setBusy] = useState(false);

	const toggle = async () => {
		setBusy(true);
		try {
			if (installed) {
				onUninstall(entry.id);
			} else {
				onInstall(entry.id);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={`plugin-card ${installed ? "plugin-card--enabled" : ""}`}>
			<div className="plugin-card__icon">
				{entry.icon ? <Icon path={entry.icon} size={32} /> : null}
			</div>
			<div className="plugin-card__info">
				<div className="plugin-card__name">{entry.name}</div>
				{entry.description && <div className="plugin-card__desc">{entry.description}</div>}
			</div>
			<button
				className={`button plugin-card__toggle ${installed ? "button--danger" : "button--primary"}`}
				onClick={toggle}
				disabled={busy}
			>
				{busy ? "..." : installed ? "Disable" : "Enable"}
			</button>
		</div>
	);
}

export function PluginMarketplace({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [tab, setTab] = useState<Tab>("core");
	const [registry, setRegistry] = useState<RegistryEntry[] | null>(registryCache);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
	const [, rerender] = useState(0);

	const corePlugins = getPlugins().filter((p) => p.core);

	useEffect(() => {
		if (!open) return;
		cmd.listUserPlugins().then((manifests: PluginManifest[]) => {
			setInstalledIds(new Set(manifests.map((m) => m.id)));
		});
	}, [open, tab]);

	const fetchRegistry = useCallback(() => {
		setFetchError(null);
		fetch(REGISTRY_URL)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((data: RegistryEntry[]) => {
				registryCache = data;
				setRegistry(data);
			})
			.catch((e) => setFetchError(e.message));
	}, []);

	useEffect(() => {
		if (open && tab === "additional" && !registry) fetchRegistry();
	}, [open, tab, registry, fetchRegistry]);

	const handleInstall = useCallback(async (id: string) => {
		try {
			const manifest = await cmd.installPlugin(id);
			await loadAndActivatePlugin(manifest);
			setPluginEnabled(id, true);
			setInstalledIds((prev) => new Set([...prev, id]));
			rerender((n) => n + 1);
		} catch (e) {
			log.error(`[marketplace] install failed for "${id}":`, e);
		}
	}, []);

	const handleUninstall = useCallback(async (id: string) => {
		deactivatePlugin(id);
		setPluginEnabled(id, false);
		unregisterPlugin(id);
		try {
			await cmd.uninstallPlugin(id);
		} catch (e) {
			log.error(`[marketplace] uninstall failed for "${id}":`, e);
		}
		setInstalledIds((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
		rerender((n) => n + 1);
	}, []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Plugins" className="plugin-marketplace">
				<div className="plugin-marketplace__tabs">
					<button
						className={`plugin-marketplace__tab ${tab === "core" ? "plugin-marketplace__tab--active" : ""}`}
						onClick={() => setTab("core")}
					>
						Core
					</button>
					<button
						className={`plugin-marketplace__tab ${tab === "additional" ? "plugin-marketplace__tab--active" : ""}`}
						onClick={() => setTab("additional")}
					>
						Additional
					</button>
				</div>

				{tab === "core" && (
					<div className="plugin-marketplace__grid">
						{corePlugins.map((p) => (
							<CoreCard key={p.id} plugin={p} />
						))}
					</div>
				)}

				{tab === "additional" && (
					<>
						{!registry && !fetchError && (
							<div className="plugin-marketplace__empty">Loading...</div>
						)}
						{fetchError && (
							<div className="plugin-marketplace__empty">
								Failed to load registry: {fetchError}
								<br />
								<button className="button" onClick={fetchRegistry} style={{ marginTop: 8 }}>
									Retry
								</button>
							</div>
						)}
						{registry && registry.length === 0 && (
							<div className="plugin-marketplace__empty">No additional plugins available.</div>
						)}
						{registry && registry.length > 0 && (
							<div className="plugin-marketplace__grid">
								{registry.map((entry) => (
									<AdditionalCard
										key={entry.id}
										entry={entry}
										installed={installedIds.has(entry.id)}
										onInstall={handleInstall}
										onUninstall={handleUninstall}
									/>
								))}
							</div>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
