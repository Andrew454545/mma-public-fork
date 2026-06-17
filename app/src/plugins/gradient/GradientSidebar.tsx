import { useState, useEffect, useMemo, useCallback } from "react";
import { Sidebar, Field, EmptyState, SegmentedControl } from "@/components/primitives/Sidebar";
import { ScopeSelector } from "@/components/primitives/ScopeSelector";
import type { ExtraFieldDef } from "@/bindings.gen";
import { getFieldDef } from "@/lib/data/fieldDefRegistry";
import { isNumericField, buildGradientSelections } from "./gradientMath";
import { fetchAllLocations, applyScope, useScope } from "@/store/useMapStore";
import "./gradient.css";

interface GradientPreset {
	name: string;
	stops: [number, number, number][];
}

const PRESETS: GradientPreset[] = [
	{
		name: "Blue-Red",
		stops: [
			[66, 133, 244],
			[234, 67, 53],
		],
	},
	{
		name: "Green-Yellow-Red",
		stops: [
			[52, 168, 83],
			[251, 188, 4],
			[234, 67, 53],
		],
	},
	{
		name: "Purple-Orange",
		stops: [
			[136, 84, 208],
			[255, 152, 0],
		],
	},
	{
		name: "Cool-Warm",
		stops: [
			[33, 150, 243],
			[200, 200, 200],
			[244, 67, 54],
		],
	},
	{
		name: "Viridis",
		stops: [
			[68, 1, 84],
			[59, 82, 139],
			[33, 145, 140],
			[94, 201, 98],
			[253, 231, 37],
		],
	},
];

const BUCKET_COUNTS = [5, 10, 15, 20];

interface FieldOption {
	key: string;
	label: string;
	def: ExtraFieldDef | undefined;
	numeric: boolean;
}

export function GradientSidebar({ onClose }: { onClose: () => void }) {
	const [fieldKey, setFieldKey] = useState("");
	const [presetIdx, setPresetIdx] = useState(0);
	const [bucketCount, setBucketCount] = useState(10);
	const [applying, setApplying] = useState(false);
	const scopeCtl = useScope();

	const map = MMA.getCurrentMap();

	const knownKeys = MMA.getKnownFieldKeys();
	const fields = useMemo((): FieldOption[] => {
		const result: FieldOption[] = [];
		for (const key of knownKeys) {
			const def = getFieldDef(key);
			const numeric = isNumericField(def);
			if (!def || numeric || def.type === "enum" || def.type === "string" || def.type === "month") {
				result.push({ key, label: def?.label ?? key, def, numeric });
			}
		}
		return result;
	}, [knownKeys]);

	useEffect(() => {
		if (fieldKey || fields.length === 0) return;
		const alt = fields.find((f) => f.key === "altitude");
		setFieldKey(alt ? alt.key : fields[0].key);
	}, [fields, fieldKey]);

	const preset = PRESETS[presetIdx];
	const fieldOpt = fields.find((f) => f.key === fieldKey);

	const applyGradient = useCallback(async () => {
		if (!fieldOpt || !map) return;
		setApplying(true);
		try {
			// Read the pool before resetSelections — scope "selected" reads the live selection.
			const pool = applyScope(scopeCtl.scope, await fetchAllLocations());
			const values: { id: number; raw: unknown }[] = [];
			for (const loc of pool) {
				const v = loc.extra?.[fieldKey];
				if (v != null) values.push({ id: loc.id, raw: v });
			}

			const sels = buildGradientSelections(values, {
				numeric: fieldOpt.numeric,
				fieldKey,
				fieldType: fieldOpt.def?.type,
				stops: preset.stops,
				bucketCount,
				scoped: scopeCtl.scope.kind === "selected",
			});
			if (sels.length === 0) return;

			await MMA.resetSelections();
			await MMA.addSelections(sels.map((s) => s.props));
			MMA.setSelectionColors(sels.map((s) => ({ key: s.key, color: s.color })));
		} finally {
			setApplying(false);
		}
	}, [fieldKey, fieldOpt, map, bucketCount, preset, scopeCtl.scope]);

	return (
		<Sidebar title="Gradient" onBack={onClose} className="gradient-sidebar">
			{fields.length === 0 ? (
				<EmptyState>No extra fields on this map. Enrich locations first.</EmptyState>
			) : (
				<>
					<Field label="Apply to">
						<ScopeSelector ctl={scopeCtl} />
					</Field>
					<Field label="Field">
						<select
							className="nselect"
							value={fieldKey}
							onChange={(e) => {
								setFieldKey(e.target.value);
							}}
						>
							{fields.map((f) => (
								<option key={f.key} value={f.key}>
									{f.label}
								</option>
							))}
						</select>
					</Field>

					<Field label="Gradient">
						<div className="gradient-sidebar__presets">
							{PRESETS.map((p, i) => (
								<button
									key={p.name}
									className={`gradient-sidebar__preset ${i === presetIdx ? "gradient-sidebar__preset--active" : ""}`}
									onClick={() => {
										setPresetIdx(i);
									}}
									title={p.name}
								>
									<div
										className="gradient-sidebar__preset-bar"
										style={{
											background: `linear-gradient(to right, ${p.stops
												.map(
													(s, si) =>
														`rgb(${s[0]},${s[1]},${s[2]}) ${(si / (p.stops.length - 1)) * 100}%`,
												)
												.join(", ")})`,
										}}
									/>
								</button>
							))}
						</div>
					</Field>

					{fieldOpt?.numeric && (
						<Field label="Buckets">
							<SegmentedControl
								value={bucketCount}
								onChange={setBucketCount}
								options={BUCKET_COUNTS.map((n) => ({ value: n, label: String(n) }))}
							/>
						</Field>
					)}

					<div className="gradient-sidebar__preview">
						<span className="gradient-sidebar__control-label">Preview</span>
						<div
							className="gradient-sidebar__preview-bar"
							style={{
								background: `linear-gradient(to right, ${preset.stops
									.map(
										(s, i) =>
											`rgb(${s[0]},${s[1]},${s[2]}) ${(i / (preset.stops.length - 1)) * 100}%`,
									)
									.join(", ")})`,
							}}
						/>
						<div className="gradient-sidebar__preview-labels">
							<span>Low</span>
							<span>High</span>
						</div>
					</div>

					<button
						className="button button--primary gradient-sidebar__apply"
						onClick={applyGradient}
						disabled={applying || !fieldKey}
					>
						Apply
					</button>
				</>
			)}
		</Sidebar>
	);
}
