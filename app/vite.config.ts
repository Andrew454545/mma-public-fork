import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import https from "node:https";
import http from "node:http";

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
	plugins: [
		react(),
		{
			name: "svtile-proxy",
			configureServer(server) {
				// console.error('[SVTILE MIDDLEWARE REGISTERED]');
				server.middlewares.use((req, res, next) => {
					// console.error(`[SVTILE REQ] ${req.url}`);
					if (!req.url?.startsWith("/svtile/")) return next();
					const path = req.url.slice("/svtile/".length).replace(/^\/+/, "");
					const target = `https://lh3.ggpht.com/jsapi2/a/b/c/${path}`;
					// process.stderr.write(`[svtile] -> ${target}\n`);
					https
						.get(
							target,
							{
								headers: {
									"user-agent": req.headers["user-agent"] || "",
									accept: req.headers["accept"] || "image/*"
								},
							},
							(proxyRes) => {
								// process.stderr.write(`[svtile] <- ${proxyRes.statusCode}\n`);
								res.writeHead(proxyRes.statusCode || 502, {
									"content-type": proxyRes.headers["content-type"] || "image/jpeg",
									"access-control-allow-origin": "*",
									"cache-control": "private, max-age=86400",
								});
								proxyRes.pipe(res);
							},
						)
						.on("error", (e) => {
							// process.stderr.write(`[svtile] error: ${e.message}\n`);
							res.writeHead(502);
							res.end();
						});
				});
			},
		},
		{
			name: "gmaps-proxy",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (!req.url?.startsWith("/gmaps/")) return next();
					const target = "https://www.google.com" + req.url.slice("/gmaps".length);
					const chunks: Buffer[] = [];
					req.on("data", (c: Buffer) => chunks.push(c));
					req.on("end", () => {
						const body = Buffer.concat(chunks);
						const parsed = new URL(target);
						const opts: https.RequestOptions = {
							hostname: parsed.hostname,
							path: parsed.pathname + parsed.search,
							method: req.method || "POST",
							headers: {
								"content-type": req.headers["content-type"] || "application/x-www-form-urlencoded",
								"content-length": body.length,
								"user-agent": req.headers["user-agent"] || "",
							},
						};
						https
							.request(opts, (proxyRes) => {
								res.writeHead(proxyRes.statusCode || 502, {
									"content-type": proxyRes.headers["content-type"] || "text/plain",
									"access-control-allow-origin": "*",
								});
								proxyRes.pipe(res);
							})
							.on("error", () => {
								res.writeHead(502);
								res.end();
							})
							.end(body);
					});
				});
			},
		},
		{
			name: "googl-resolve-proxy",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (!req.url?.startsWith("/googl/")) return next();
					const parsed = new URL(req.url, "http://localhost");
					const id = parsed.pathname.slice("/googl/".length);
					const source = parsed.searchParams.get("source");
					if (!id) {
						res.writeHead(400);
						res.end();
						return;
					}
					const host = source === "mapsapp" ? "maps.app.goo.gl" : "goo.gl";
					const path = source === "mapsapp" ? `/${id}` : `/maps/${id}`;
					https
						.get({ hostname: host, path, headers: { "user-agent": "" } }, (proxyRes) => {
							const location = proxyRes.headers["location"];
							if (location) {
								res.writeHead(200, {
									"content-type": "application/json",
									"access-control-allow-origin": "*",
								});
								res.end(JSON.stringify(location));
							} else {
								const chunks: Buffer[] = [];
								proxyRes.on("data", (c: Buffer) => chunks.push(c));
								proxyRes.on("end", () => {
									res.writeHead(404, { "access-control-allow-origin": "*" });
									res.end();
								});
							}
						})
						.on("error", () => {
							res.writeHead(502);
							res.end();
						});
				});
			},
		},
	],
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
