const { registerPlugin } = window.MMA;
import { DistributionSidebar } from "./DistributionSidebar";
import { mdiChartBar } from "@mdi/js";

registerPlugin({
	id: "distribution",
	name: "Distribution",
	description: "View how locations are distributed across countries",
	icon: mdiChartBar,
	activate() {},
	sidebar: DistributionSidebar,
});
