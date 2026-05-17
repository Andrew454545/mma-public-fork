import { useActivePluginId } from "@/store/useMapStore";
import { getPlugin } from "@/plugins/registry";
import { exitPluginMode } from "@/store/useMapStore";

export function PluginSidebarHost() {
	const pluginId = useActivePluginId();
	if (!pluginId) return null;
	const plugin = getPlugin(pluginId);
	if (!plugin?.sidebar) return null;
	const Sidebar = plugin.sidebar;
	return <Sidebar onClose={exitPluginMode} />;
}
