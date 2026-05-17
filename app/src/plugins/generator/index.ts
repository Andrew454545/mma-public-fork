const { registerPlugin } = window.MMA;
import { GeneratorSidebar } from "./ui/GeneratorSidebar";
import { mdiMapMarkerPlus } from "@mdi/js";

registerPlugin({
	id: "map-generator",
	name: "Map generator",
	description: "Generate locations from Street View coverage",
	icon: mdiMapMarkerPlus,
	activate() {},
	sidebar: GeneratorSidebar,
});
