export const SV_COLORS = [
	"red",
	"pink",
	"purple",
	"violet",
	"indigo",
	"blue",
	"cyan",
	"teal",
	"green",
	"lime",
	"yellow",
	"orange",
	"choco",
] as const;
export type SvColor = (typeof SV_COLORS)[number];

export type MapTypeKey = "map" | "satellite" | "osm";
