import { describe, it, expect } from "vitest";
import { detectCameraType, cameraTypeFromHeight } from "@/lib/sv/svMeta";

type SvData = google.maps.StreetViewResolvedPanoramaData;

function makeData(opts: {
	height: number;
	imageDate?: string;
	countryCode?: string | null;
	levelId?: string | null;
	lat?: number;
}): SvData {
	const { height, imageDate, countryCode = null, levelId = null, lat = 0 } = opts;
	return {
		tiles: { worldSize: { width: 0, height } },
		imageDate,
		location: { latLng: { lat: () => lat, lng: () => 0 } },
		extra: { countryCode, _levelId: levelId },
	} as unknown as SvData;
}

describe("cameraTypeFromHeight", () => {
	it("maps tile world heights to generations", () => {
		expect(cameraTypeFromHeight(1664)).toBe("gen1");
		expect(cameraTypeFromHeight(6656)).toBe("gen2");
		expect(cameraTypeFromHeight(8192)).toBe("gen4");
		expect(cameraTypeFromHeight(999)).toBe(null);
	});
});

describe("detectCameraType", () => {
	it("returns gen1/gen4 directly from height", () => {
		expect(detectCameraType(makeData({ height: 1664 }))).toBe("gen1");
		expect(detectCameraType(makeData({ height: 8192 }))).toBe("gen4");
	});

	it("gen2-height pano with no badcam/tripod signals is gen2", () => {
		expect(detectCameraType(makeData({ height: 6656, imageDate: "2024-05" }))).toBe("gen2");
	});

	it("gen2-height pano with _levelId is tripod", () => {
		expect(detectCameraType(makeData({ height: 6656, levelId: "L1" }))).toBe("tripod");
	});

	it("classifies a badcam-country pano past its threshold as badcam", () => {
		// India threshold: after 2021-10
		expect(
			detectCameraType(makeData({ height: 6656, countryCode: "IN", imageDate: "2022-01" })),
		).toBe("badcam");
	});

	it("does not mark a badcam-country pano before its threshold", () => {
		expect(
			detectCameraType(makeData({ height: 6656, countryCode: "IN", imageDate: "2020-01" })),
		).toBe("gen2");
	});

	it("badcam takes priority over tripod when both apply (matches original nf)", () => {
		// Tripod (_levelId) AND in a badcam country past threshold -> original returns badcam.
		expect(
			detectCameraType(
				makeData({ height: 6656, countryCode: "IN", imageDate: "2022-01", levelId: "L1" }),
			),
		).toBe("badcam");
	});

	it("US badcam only above latitude 52", () => {
		const past = { height: 6656, countryCode: "US", imageDate: "2020-01" } as const;
		expect(detectCameraType(makeData({ ...past, lat: 60 }))).toBe("badcam");
		expect(detectCameraType(makeData({ ...past, lat: 40 }))).toBe("gen2");
	});
});
