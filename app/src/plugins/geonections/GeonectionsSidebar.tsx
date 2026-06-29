import { useState, useSyncExternalStore } from "react";
import { mdiCheckCircleOutline, mdiChevronLeft, mdiChevronRight, mdiContentCopy, mdiDeleteOutline, mdiFlagOutline, mdiMapMarkerCheckOutline, mdiOpenInNew, mdiPlay, mdiSendCircle, mdiStop, mdiTagOutline } from "@mdi/js";
import { Icon } from "@/components/primitives/Icon";
import { Field, Section, Sidebar } from "@/components/primitives/Sidebar";
import { useActiveLocation, useCurrentMap, useSelectedLocationIds } from "@/store/useMapStore";
import {
	checkCountryDifficultyConsistency,
	closeCurrentLocation,
	copyCurrentMapsLink,
	deleteCurrentLocation,
	getGeonectionsSnapshot,
	navigateRelative,
	openDiscord,
	openLocationsInMaps,
	selectAllLocations,
	setAutoplayDelay,
	setAutoplayEnabled,
	setGeonectionsMode,
	subscribeGeonections,
	tagAllMissingCountries,
	tagCurrent,
	tagCurrentCountry,
	tagMissingCountry,
	tagMissingDifficulty,
	tagMissingPanoIds,
	tagRoadNamesForScope,
	toggleFullscreenMap,
} from "./runtime";
import "./geonections.css";

const DELAYS = [1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 90000];

function ActionButton({
	icon,
	children,
	onClick,
	disabled,
	variant,
}: {
	icon?: string;
	children: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: "danger" | "primary";
}) {
	return (
		<button
			type="button"
			className={`button geonections-action${variant === "primary" ? " button--primary" : ""}${variant === "danger" ? " button--danger" : ""}`}
			onClick={onClick}
			disabled={disabled}
		>
			{icon && <Icon path={icon} size={15} />}
			<span>{children}</span>
		</button>
	);
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
	return (
		<div className="geonections-shortcut">
			<kbd>{keys}</kbd>
			<span>{label}</span>
		</div>
	);
}

export function GeonectionsSidebar({ onClose }: { onClose: () => void }) {
	const snapshot = useSyncExternalStore(subscribeGeonections, getGeonectionsSnapshot);
	const selectedIds = useSelectedLocationIds();
	const map = useCurrentMap();
	const active = useActiveLocation();
	const [lastSummary, setLastSummary] = useState("");

	const scopeText = selectedIds.size > 0
		? `${selectedIds.size} selected`
		: `${map?.meta.locationCount ?? 0} total`;

	const busy = snapshot.status.busy;
	const run = (action: () => Promise<unknown>, summary?: (value: unknown) => string) => {
		action()
			.then((value) => {
				if (summary) setLastSummary(summary(value));
			})
			.catch((error: unknown) => {
				setLastSummary(error instanceof Error ? error.message : String(error));
			});
	};

	return (
		<Sidebar title="Geonections" onBack={onClose} className="geonections-sidebar">
			<Section title="Mode" collapsible={false}>
				<label className="geonections-check">
					<input
						type="checkbox"
						checked={snapshot.modeEnabled}
						onChange={(event) => setGeonectionsMode(event.target.checked)}
					/>
					<span>Geonections Mode</span>
				</label>
				<div className="geonections-stats">
					<span>{active ? `Active #${active.id}` : "No active location"}</span>
					<span>{scopeText}</span>
				</div>
				<Field label="Autoplay" row>
					<button
						type="button"
						className="button geonections-compact-button"
						onClick={() => setAutoplayEnabled(!snapshot.autoplayEnabled)}
						disabled={!snapshot.modeEnabled}
					>
						<Icon path={snapshot.autoplayEnabled ? mdiStop : mdiPlay} size={15} />
						{snapshot.autoplayEnabled ? "Stop" : "Start"}
					</button>
				</Field>
				<Field label="Delay" row>
					<select
						className="input geonections-delay"
						value={snapshot.autoplayDelayMs}
						onChange={(event) => setAutoplayDelay(Number(event.target.value))}
					>
						{DELAYS.map((ms) => (
							<option key={ms} value={ms}>
								{ms / 1000}s
							</option>
						))}
					</select>
				</Field>
				<div className={`geonections-status${busy ? " is-busy" : ""}`}>
					{snapshot.status.message}
				</div>
				{lastSummary && <div className="geonections-summary">{lastSummary}</div>}
			</Section>

			<Section title="Review">
				<div className="geonections-grid geonections-grid--two">
					<ActionButton icon={mdiChevronLeft} onClick={() => run(() => navigateRelative(-1))}>
						Previous
					</ActionButton>
					<ActionButton icon={mdiChevronRight} onClick={() => run(() => navigateRelative(1))}>
						Next
					</ActionButton>
					<ActionButton icon={mdiContentCopy} onClick={() => run(copyCurrentMapsLink)}>
						Copy Maps
					</ActionButton>
					<ActionButton icon={mdiOpenInNew} onClick={() => run(() => openLocationsInMaps(16))}>
						Open 16
					</ActionButton>
					<ActionButton icon={mdiMapMarkerCheckOutline} onClick={() => run(selectAllLocations)}>
						Select All
					</ActionButton>
					<ActionButton onClick={toggleFullscreenMap}>Hide UI</ActionButton>
					<ActionButton onClick={() => run(closeCurrentLocation)}>Close</ActionButton>
					<ActionButton icon={mdiDeleteOutline} variant="danger" onClick={() => run(deleteCurrentLocation)}>
						Delete
					</ActionButton>
				</div>
			</Section>

			<Section title="Quick Tags">
				<div className="geonections-grid geonections-grid--two">
					{["Easy", "Medium", "Hard", "Expert"].map((tag) => (
						<ActionButton key={tag} icon={mdiTagOutline} onClick={() => run(() => tagCurrent(tag))}>
							{tag}
						</ActionButton>
					))}
					<ActionButton icon={mdiCheckCircleOutline} onClick={() => run(() => tagCurrent("Usable"))}>
						Usable
					</ActionButton>
					<ActionButton icon={mdiFlagOutline} onClick={() => run(tagCurrentCountry)}>
						Country
					</ActionButton>
				</div>
			</Section>

			<Section title="Final Check">
				<div className="geonections-stack">
					<ActionButton disabled={busy} onClick={() => run(tagMissingPanoIds)}>
						Find missing pano ID
					</ActionButton>
					<ActionButton
						disabled={busy}
						onClick={() =>
							run(tagRoadNamesForScope, (value) => {
								const summary = value as Awaited<ReturnType<typeof tagRoadNamesForScope>>;
								return `Road names: ${summary.hasRoad} has, ${summary.noRoad} no road, ${summary.skipped} skipped`;
							})
						}
					>
						Tag road names
					</ActionButton>
					<ActionButton disabled={busy} onClick={() => run(tagMissingDifficulty)}>
						Find missing difficulty
					</ActionButton>
					<ActionButton disabled={busy} onClick={() => run(tagMissingCountry)}>
						Find missing country
					</ActionButton>
					<ActionButton disabled={busy} onClick={() => run(checkCountryDifficultyConsistency, String)}>
						Check tags
					</ActionButton>
					<ActionButton disabled={busy} onClick={() => run(tagAllMissingCountries)}>
						Tag all missing country
					</ActionButton>
					<ActionButton icon={mdiSendCircle} variant="primary" onClick={openDiscord}>
						Submit to Discord
					</ActionButton>
				</div>
			</Section>

			<Section title="Shortcuts" defaultOpen={false}>
				<div className="geonections-shortcuts">
						<Shortcut keys="Left" label="Previous" />
						<Shortcut keys="G / Right" label="Next" />
					<Shortcut keys="Space" label="Autoplay" />
					<Shortcut keys="1-4" label="Easy, Medium, Hard, Expert" />
					<Shortcut keys="T / U" label="Country / Usable" />
					<Shortcut keys="C / S" label="Delete / close" />
					<Shortcut keys="O / A" label="Open tabs / select all" />
					<Shortcut keys="H" label="Hide UI" />
					<Shortcut keys="Cmd/Ctrl+C" label="Copy Maps link" />
				</div>
			</Section>
		</Sidebar>
	);
}
