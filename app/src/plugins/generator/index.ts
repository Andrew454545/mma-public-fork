const { registerPlugin } = window.MMA;
import { GeneratorSidebar } from "./ui/GeneratorSidebar";
import { mountCoverageOverlay } from "./coverageOverlay";
import { mdiMapMarkerPlus } from "@mdi/js";

registerPlugin({
	id: "map-generator",
	name: "Map generator",
	description: "Generate locations from Street View coverage",
	icon: mdiMapMarkerPlus,
	activate() {
		return mountCoverageOverlay();
	},
	sidebar: GeneratorSidebar,
});
