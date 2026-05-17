const { registerPlugin } = window.MMA;
import { mdiAccountGroup } from "@mdi/js";

registerPlugin({
	id: "collab",
	name: "Collaboration",
	description: "Work on a map together in real-time (P2P)",
	icon: mdiAccountGroup,
	comingSoon: true,
	activate() {},
});
