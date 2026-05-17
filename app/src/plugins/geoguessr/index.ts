const { registerPlugin } = window.MMA;
import { mdiMapMarker } from "@mdi/js";

registerPlugin({
	id: "geoguessr",
	name: "GeoGuessr",
	description: "Push and pull locations to/from a linked GeoGuessr map",
	icon: mdiMapMarker,
	comingSoon: true,
	activate() {},
});
