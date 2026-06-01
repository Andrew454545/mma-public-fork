const { registerPlugin } = window.MMA;
import { DisambiguateSidebar } from "./DisambiguateSidebar";
import { mdiCompare } from "@mdi/js";

registerPlugin({
	id: "disambiguate",
	name: "Disambiguate",
	description: "Rank metadata fields by how strongly they separate selections",
	icon: mdiCompare,
	activate() {},
	sidebar: DisambiguateSidebar,
});
