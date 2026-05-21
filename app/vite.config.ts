import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// console.error('[VITE CONFIG LOADED]');

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify(process.env.npm_package_version),
	},
	// SV tiles (svtile), the Maps batchexecute RPC (gmaps), and short-link
	// resolution (googl) are served by Tauri Rust URI-scheme handlers now
	// (work in dev + release), so no vite dev proxies are needed.
	plugins: [react()],
	optimizeDeps: {
		include: [
			"@deck.gl/core",
			"@deck.gl/layers",
			"@deck.gl/google-maps",
			"@luma.gl/core",
			"@luma.gl/shadertools",
			"@luma.gl/engine",
			"@luma.gl/webgl",
		],
	},
});
