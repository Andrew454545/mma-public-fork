import { useEffect, useState } from "react";
import { getCachedPanoDate, setCachedPanoDate } from "@/lib/storage/storage";
import { resolveExactTimestamp } from "@/lib/sv/exactDate.add";

export function useExactDate(
	panoId: string | null,
	lat: number,
	lng: number,
	yearMonth: string | null,
	enabled: boolean,
) {
	const [state, setState] = useState<{
		ts: number | null;
		loading: boolean;
		error: boolean;
	}>({
		ts: null,
		loading: false,
		error: false,
	});

	useEffect(() => {
		if (!enabled || !panoId || !yearMonth) {
			setState({ ts: null, loading: false, error: false });
			return;
		}
		let cancelled = false;
		setState({ ts: null, loading: true, error: false });

		(async () => {
			const cached = await getCachedPanoDate(panoId);
			if (cancelled) return;
			if (cached !== null) {
				setState({ ts: cached, loading: false, error: false });
				return;
			}
			try {
				const ts = await resolveExactTimestamp(lat, lng, yearMonth);
				if (cancelled) return;
				await setCachedPanoDate(panoId, ts);
				setState({ ts, loading: false, error: false });
			} catch {
				if (!cancelled) setState({ ts: null, loading: false, error: true });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [panoId, lat, lng, yearMonth, enabled]);

	return state;
}
