const OFFICIAL_PANO_RE = /^[-_A-Za-z0-9]{21}[AQgw]$/;

export function isOfficialPano(panoId: string): boolean {
	if (panoId.startsWith("F:")) return false;
	return OFFICIAL_PANO_RE.test(panoId);
}
