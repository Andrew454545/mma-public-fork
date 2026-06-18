import { describe, it, expect } from "vitest";
import { isPluginUpdatable } from "@/plugins/registry";

describe("isPluginUpdatable", () => {
	it("flags an update when versions differ", () => {
		expect(isPluginUpdatable("1.0.0", "1.1.0")).toBe(true);
	});

	it("no update when versions match", () => {
		expect(isPluginUpdatable("1.0.0", "1.0.0")).toBe(false);
	});

	it("no update when the installed version is unknown", () => {
		expect(isPluginUpdatable("", "1.0.0")).toBe(false);
		expect(isPluginUpdatable(undefined, "1.0.0")).toBe(false);
	});

	it("no update when the registry version is unknown", () => {
		expect(isPluginUpdatable("1.0.0", "")).toBe(false);
		expect(isPluginUpdatable("1.0.0", undefined)).toBe(false);
	});

	// Plain inequality, not semver ordering — a downgrade still reads as "differs".
	it("treats any mismatch as updatable, including lower registry versions", () => {
		expect(isPluginUpdatable("1.1.0", "1.0.0")).toBe(true);
	});
});
