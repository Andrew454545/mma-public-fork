import { useState, useEffect, useCallback, useRef } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { ValidationState } from "@/store/selections";
import { validateLocations, type ValidationProgress } from "@/lib/sv/validate";
import { useCurrentMap, addSelection, fetchAllLocations } from "@/store/useMapStore";

function ValidationContent() {
	const map = useCurrentMap();
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const controllerRef = useRef<AbortController | null>(null);

	const run = useCallback(async () => {
		if (!map) return;
		const controller = new AbortController();
		controllerRef.current = controller;

		try {
			const locs = await fetchAllLocations();
			const results = await validateLocations(locs, {
				signal: controller.signal,
				onProgress: (p: ValidationProgress) => setProgress(p.progress),
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
					addSelection({
						type: "ValidationState",
						locations: locs.map((l) => l.id),
						state,
					});
				}
			}
		} catch (e: unknown) {
			if (!(e instanceof Error && e.name === "AbortError")) {
				setError(e instanceof Error ? e.message : "Validation failed");
			}
		}
	}, [map]);

	useEffect(() => {
		run();
		return () => {
			controllerRef.current?.abort();
		};
	}, [run]);

	return (
		<>
			{error && <p className="error">{error}</p>}
			<progress value={progress} max={1} style={{ width: "100%" }} />
		</>
	);
}

export function ValidationDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	return (
		<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="modal__backdrop" />
				<RadixDialog.Content className="modal edit-map-modal">
					<RadixDialog.Title className="modal__title">Validation</RadixDialog.Title>
					{open && <ValidationContent />}
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}
