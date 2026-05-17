import { useState } from "react";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { Icon } from "@/components/primitives/Icon";
import {
	getPlugins,
	isPluginEnabled,
	setPluginEnabled,
	activatePlugin,
	deactivatePlugin,
} from "@/plugins/registry";
import type { Plugin } from "@/plugins/registry";

function PluginCard({ plugin }: { plugin: Plugin }) {
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

export function PluginMarketplace({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const plugins = getPlugins();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Plugins" className="plugin-marketplace">
				{plugins.length === 0 ? (
					<div className="plugin-marketplace__empty">No plugins installed.</div>
				) : (
					<div className="plugin-marketplace__grid">
						{plugins.map((p) => (
							<PluginCard key={p.id} plugin={p} />
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
