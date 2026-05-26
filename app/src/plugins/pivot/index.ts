const { registerPlugin } = window.MMA;
import { PivotSidebar } from "./PivotSidebar";
import { mdiTablePivot } from "@mdi/js";

registerPlugin({
	id: "pivot",
	name: "Pivot Table",
	description: "Cross-tabulate selections against location metadata",
	icon: mdiTablePivot,
	activate() {},
	sidebar: PivotSidebar,
});
