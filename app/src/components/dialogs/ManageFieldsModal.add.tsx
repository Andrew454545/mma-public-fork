import { useState } from "react";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { setMapExtraFields, getKnownFieldKeys } from "@/store/useMapStore";
import type { ExtraFieldDef } from "@/types";
import { getFieldDef, getAllFieldDefs } from "@/lib/data/fieldDefRegistry";

type Comparison = NonNullable<ExtraFieldDef["comparison"]>;
const FIELD_TYPES: ExtraFieldDef["type"][] = ["string", "number", "date", "month", "enum"];
const TYPE_LABELS: Record<ExtraFieldDef["type"], string> = {
	string: "Text",
	number: "Number",
	date: "Date/time",
	month: "Month (YYYY-MM)",
	enum: "Enum",
};

// How a field is compared during disambiguation. "auto" = inferred from type.
type CompToken = "auto" | "linear" | "circular" | "categorical";
const COMP_OPTIONS: { token: CompToken; label: string }[] = [
	{ token: "auto", label: "Auto" },
	{ token: "linear", label: "Numeric" },
	{ token: "circular", label: "Circular" },
	{ token: "categorical", label: "Categorical" },
];
const DEFAULT_PERIOD = 360;

function compToToken(c: ExtraFieldDef["comparison"]): CompToken {
	if (!c) return "auto";
	return c.type;
}

function tokenToComp(t: CompToken, period: number): Comparison | undefined {
	switch (t) {
		case "auto": return undefined;
		case "linear": return { type: "linear" };
		case "categorical": return { type: "categorical" };
		case "circular": return { type: "circular", period };
	}
}

interface FieldRow {
	key: string;
	label: string;
	type: ExtraFieldDef["type"];
	comparison: ExtraFieldDef["comparison"];
	hasData: boolean;
}

export function ManageFieldsModal({ onClose }: { onClose: () => void }) {
	const knownKeys = getKnownFieldKeys();
	const allDefs = getAllFieldDefs();

	const allKeys = new Set<string>(knownKeys);
	for (const k of Object.keys(allDefs)) allKeys.add(k);

	const initialRows: FieldRow[] = [...allKeys].sort().map((key) => {
		const def = getFieldDef(key);
		return {
			key,
			label: def?.label ?? key,
			type: def?.type ?? "string",
			comparison: def?.comparison ?? null,
			hasData: knownKeys.has(key),
		};
	});

	const [rows, setRows] = useState(initialRows);
	// Open period prompt for circular comparison: { key, value } while picking, else null.
	const [periodPrompt, setPeriodPrompt] = useState<{ key: string; value: string } | null>(null);

	const updateRow = (key: string, patch: Partial<FieldRow>) => {
		setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
	};

	const confirmPeriod = () => {
		if (!periodPrompt) return;
		const period = parseFloat(periodPrompt.value);
		updateRow(periodPrompt.key, {
			comparison: { type: "circular", period: Number.isFinite(period) && period > 0 ? period : DEFAULT_PERIOD },
		});
		setPeriodPrompt(null);
	};

	const handleSave = async () => {
		const fields: Record<string, ExtraFieldDef> = {};
		for (const row of rows) {
			const entry: ExtraFieldDef = { type: row.type, label: row.label };
			const existing = getFieldDef(row.key);
			if (existing?.values) entry.values = existing.values;
			if (existing?.labels) entry.labels = existing.labels;
			if (row.comparison) entry.comparison = row.comparison;
			fields[row.key] = entry;
		}
		await setMapExtraFields(fields);
		onClose();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent title="Manage metadata fields" className="manage-fields-modal">
				{rows.length === 0 ? (
					<p>No metadata fields found on this map.</p>
				) : (
					<table className="manage-fields-table">
						<thead>
							<tr>
								<th>Field</th>
								<th>Label</th>
								<th>Type</th>
								<th>Compare as</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.key}>
									<td className="manage-fields-table__key">
										{row.key}
										{!row.hasData && (
											<span className="manage-fields-table__no-data"> (no data)</span>
										)}
									</td>
									<td>
										<input
											className="input"
											value={row.label}
											onChange={(e) => updateRow(row.key, { label: e.target.value })}
										/>
									</td>
									<td>
										<select
											className="nselect"
											value={row.type}
											onChange={(e) =>
												updateRow(row.key, { type: e.target.value as ExtraFieldDef["type"] })
											}
										>
											{FIELD_TYPES.map((t) => (
												<option key={t} value={t}>
													{TYPE_LABELS[t]}
												</option>
											))}
										</select>
									</td>
									<td>
										<select
											className="nselect"
											value={compToToken(row.comparison)}
											onChange={(e) => {
												const token = e.target.value as CompToken;
												// Circular needs a period: prompt for it instead of committing inline,
												// so the cell never grows. Cancelling leaves the select on its old value.
												if (token === "circular") {
													const current = row.comparison?.type === "circular" ? row.comparison.period : DEFAULT_PERIOD;
													setPeriodPrompt({ key: row.key, value: String(current) });
												} else {
													updateRow(row.key, { comparison: tokenToComp(token, DEFAULT_PERIOD) ?? null });
												}
											}}
										>
											{COMP_OPTIONS.map((o) => (
												<option key={o.token} value={o.token}>
													{o.token === "circular" && row.comparison?.type === "circular"
														? `Circular · ${row.comparison.period}`
														: o.label}
												</option>
											))}
										</select>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<div className="manage-fields-modal__actions">
					<button className="button button--primary" type="button" onClick={handleSave}>
						Save
					</button>
					<button className="button" type="button" onClick={onClose}>
						Cancel
					</button>
				</div>

				<Dialog open={periodPrompt !== null} onOpenChange={(open) => !open && setPeriodPrompt(null)}>
					<DialogContent title="Circular period" className="period-prompt">
						<p className="period-prompt__help">
							Value at which this field wraps around (e.g. 360 for degrees, 24 for hours, 12 for months).
						</p>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								confirmPeriod();
							}}
						>
							<input
								className="input"
								type="number"
								min="0"
								step="any"
								autoFocus
								value={periodPrompt?.value ?? ""}
								onChange={(e) => setPeriodPrompt((p) => (p ? { ...p, value: e.target.value } : p))}
							/>
							<div className="period-prompt__actions">
								<button className="button button--primary" type="submit">
									Set
								</button>
								<button className="button" type="button" onClick={() => setPeriodPrompt(null)}>
									Cancel
								</button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			</DialogContent>
		</Dialog>
	);
}
