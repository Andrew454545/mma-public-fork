import { isOfficialPano } from "@/lib/sv/panoId";
import { fetchSvMetadata } from "@/lib/sv/svMeta";
import { PanoType } from "@/types";
import { useState, useEffect } from "react";

export function useCameraType(panoId: string | null) {
	const [cameraType, setCameraType] = useState<FullCameraType | null>(null);
	useEffect(() => {
		if (!panoId) {
			setCameraType(null);
			return;
		}
		// Immediate check: if pano ID is not official format, it's unofficial regardless of metadata
		if (!isOfficialPano(panoId)) {
			setCameraType("unofficial");
			return;
		}
		let cancelled = false;
		fetchSvMetadata([panoId]).then(([data]) => {
			if (cancelled) return;
			if (!data || !data.extra) {
				setCameraType(null);
				return;
			}
			if (data.extra.panoType !== PanoType.Official) {
				setCameraType("unofficial");
			} else {
				setCameraType(data.extra.cameraType);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [panoId]);
	return cameraType;
}
