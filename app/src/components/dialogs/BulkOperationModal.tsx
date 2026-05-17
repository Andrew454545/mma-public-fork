import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { getCurrentMap, addSelection, fetchAllLocations } from "@/store/useMapStore";
import type { Location } from "@/types";
import { isPinnedToPano } from "@/types";
import { ValidationState } from "@/store/selections";
import { validateLocations } from "@/lib/sv/validate";
import { enrichAll, needsEnrichment, type EnrichResult } from "@/lib/sv/enrich.add";
import { bulkPinToPano } from "@/lib/sv/pinPano.add";
import { fmt } from "@/lib/util/format";

export type BulkOperation = "validate" | "enrich" | "pinPano";

interface Props {
	operation: BulkOperation;
	onClose: () => void;
}

const TITLES: Record<BulkOperation, string> = {
	validate: "Validate locations",
	enrich: "Enrich metadata",
	pinPano: "Pin to Pano ID",
};

function BulkSetup({
	operation,
	onStart,
}: {
	operation: BulkOperation;
	onStart: (force: boolean) => void;
}) {
	const [force, setForce] = useState(false);
	const [locs, setLocs] = useState<Location[]>([]);
	const map = getCurrentMap();
	useEffect(() => {
		fetchAllLocations().then(setLocs);
	}, []);
	if (!map) return null;
	const total = locs.length;

	if (operation === "enrich") {
		const unenriched = locs.filter(needsEnrichment).length;
		const noPano = locs.filter((l) => !l.panoId).length;
		return (
			<div className="bulk-operation">
				<div className="bulk-operation__status">
					{fmt.format(unenriched)} locations need enrichment.
					{noPano > 0 &&
						` ${fmt.format(noPano)} without pano ID will be resolved from coordinates.`}
				</div>
				<label className="bulk-operation__option">
					<input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
					Re-enrich already enriched locations
				</label>
				<div className="bulk-operation__actions">
					<button
						className="button button--primary"
						type="button"
						onClick={() => onStart(force)}
						disabled={!force && unenriched === 0}
					>
						Start
					</button>
				</div>
			</div>
		);
	}

	if (operation === "pinPano") {
		const unpinned = locs.filter((l) => !isPinnedToPano(l)).length;
		return (
			<div className="bulk-operation">
				<div className="bulk-operation__status">
					{fmt.format(total)} locations total. {fmt.format(unpinned)} not pinned to a pano ID.
				</div>
				<label className="bulk-operation__option">
					<input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
					Re-pin already pinned locations
				</label>
				<div className="bulk-operation__actions">
					<button
						className="button button--primary"
						type="button"
						onClick={() => onStart(force)}
						disabled={!force && unpinned === 0}
					>
						Start
					</button>
				</div>
			</div>
		);
	}

	return null;
}

function EnrichSummary({
	result,
	onSelect,
}: {
	result: EnrichResult;
	onSelect: (ids: number[], label: string) => void;
}) {
	return (
		<div className="enrich-summary">
			{(result.metaSuccess.length > 0 || result.metaFailed.length > 0) && (
				<div>
					Metadata: {fmt.format(result.metaSuccess.length)} enriched
					{result.metaFailed.length > 0 && <>, {fmt.format(result.metaFailed.length)} failed</>}
					{result.metaFailed.length > 0 && (
						<button
							className="button"
							type="button"
							style={{ marginLeft: 8 }}
							onClick={() => onSelect(result.metaFailed, "Metadata failed")}
						>
							Select failed
						</button>
					)}
				</div>
			)}
			{(result.dateSuccess.length > 0 || result.dateFailed.length > 0) && (
				<div>
					Exact dates: {fmt.format(result.dateSuccess.length)} resolved
					{result.dateFailed.length > 0 && <>, {fmt.format(result.dateFailed.length)} failed</>}
					{result.dateFailed.length > 0 && (
						<button
							className="button"
							type="button"
							style={{ marginLeft: 8 }}
							onClick={() => onSelect(result.dateFailed, "Date resolution failed")}
						>
							Select failed
						</button>
					)}
				</div>
			)}
			{result.metaSuccess.length === 0 &&
				result.metaFailed.length === 0 &&
				result.dateSuccess.length === 0 &&
				result.dateFailed.length === 0 && <div>Nothing to process.</div>}
		</div>
	);
}

function BulkProgress({
	operation,
	force,
	onClose,
}: {
	operation: BulkOperation;
	force: boolean;
	onClose: () => void;
}) {
	const [progress, setProgress] = useState(0);
	const [total, setTotal] = useState(0);
	const [done, setDone] = useState(0);
	const [status, setStatus] = useState<"running" | "done" | "cancelled" | "error">("running");
	const [error, setError] = useState<string | null>(null);
	const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null);
	const controllerRef = useRef<AbortController | null>(null);

	const run = useCallback(async () => {
		const map = getCurrentMap();
		if (!map) return;
		const controller = new AbortController();
		controllerRef.current = controller;
		const locations = await fetchAllLocations();

		const onProgress = (d: number, t: number) => {
			setTotal(t);
			setDone(d);
			setProgress(t > 0 ? d / t : 1);
		};

		try {
			if (operation === "validate") {
				const results = await validateLocations(locations, {
					signal: controller.signal,
					onProgress: (p) =>
						onProgress(Math.round(p.progress * locations.length), locations.length),
				});

				const stateOrder = [
					ValidationState.Ok,
					ValidationState.UpdateAvailable,
					ValidationState.UpdateApplied,
					ValidationState.GoodcamAvailable,
					ValidationState.PanoIdBroke,
					ValidationState.Unofficial,
					ValidationState.NotFound,
				];
				for (const state of stateOrder) {
					const locs = results.get(state);
					if (locs && locs.length > 0) {
						addSelection({ type: "ValidationState", locations: locs.map((l) => l.id), state });
					}
				}
			} else if (operation === "enrich") {
				const er = await enrichAll({
					signal: controller.signal,
					force,
					onProgress,
				});
				setEnrichResult(er);
			} else if (operation === "pinPano") {
				await bulkPinToPano({
					signal: controller.signal,
					force,
					onProgress,
				});
			}
			setProgress(1);
			setStatus("done");
		} catch (e: unknown) {
			if (e instanceof Error && e.name === "AbortError") {
				if (controllerRef.current === controller) setStatus("cancelled");
			} else {
				setError(e instanceof Error ? e.message : "Operation failed");
				setStatus("error");
			}
		}
	}, [operation, force]);

	useEffect(() => {
		run();
		return () => {
			controllerRef.current?.abort();
		};
	}, [run]);

	const pct = Math.round(progress * 100);

	return (
		<div className="bulk-operation">
			<div className="bulk-operation__status">
				{status === "running" && `${fmt.format(done)} / ${fmt.format(total)} (${pct}%)`}
				{status === "done" && enrichResult ? (
					<EnrichSummary
						result={enrichResult}
						onSelect={(ids, _label) => {
							addSelection({ type: "Manual", locations: ids });
						}}
					/>
				) : (
					status === "done" && `Done -- ${fmt.format(total)} locations processed.`
				)}
				{status === "cancelled" && `Cancelled at ${fmt.format(done)} / ${fmt.format(total)}.`}
				{status === "error" && `Error: ${error}`}
			</div>
			<progress className="bulk-operation__bar" value={progress} max={1} />
			<div className="bulk-operation__actions">
				{status === "running" ? (
					<button
						className="button button--destructive"
						type="button"
						onClick={() => controllerRef.current?.abort()}
					>
						Cancel
					</button>
				) : (
					<button className="button button--primary" type="button" onClick={onClose}>
						Close
					</button>
				)}
			</div>
		</div>
	);
}

export function BulkOperationModal({ operation, onClose }: Props) {
	const needsSetup = operation === "enrich" || operation === "pinPano";
	const [started, setStarted] = useState(!needsSetup);
	const [force, setForce] = useState(false);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent title={TITLES[operation]} className="bulk-operation-modal">
				{!started ? (
					<BulkSetup
						operation={operation}
						onStart={(f) => {
							setForce(f);
							setStarted(true);
						}}
					/>
				) : (
					<BulkProgress
						operation={operation}
						force={force}
						onClose={onClose}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
