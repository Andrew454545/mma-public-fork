import { describe, it, expect } from "vitest";
import { parseHotkey, matchesKey } from "@/lib/hooks/useHotkey";

describe("parseHotkey", () => {
	it("parses single key", () => {
		const result = parseHotkey("a");
		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].key).toBe("a");
		expect(result[0][0].ctrl).toBe(false);
	});

	it("parses modifier+key", () => {
		const result = parseHotkey("Ctrl+s");
		expect(result[0][0].ctrl).toBe(true);
		expect(result[0][0].key).toBe("s");
	});

	it("parses shift+key", () => {
		const result = parseHotkey("Shift+ArrowUp");
		expect(result[0][0].shift).toBe(true);
		expect(result[0][0].key).toBe("arrowup");
	});

	it("parses alt+key", () => {
		const result = parseHotkey("Alt+f");
		expect(result[0][0].alt).toBe(true);
		expect(result[0][0].key).toBe("f");
	});

	it("parses comma-separated alternatives", () => {
		const result = parseHotkey("a, b");
		expect(result).toHaveLength(2);
		expect(result[0][0].key).toBe("a");
		expect(result[1][0].key).toBe("b");
	});

	it("parses chord (space-separated)", () => {
		const result = parseHotkey("Ctrl+k Ctrl+s");
		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(2);
		expect(result[0][0].key).toBe("k");
		expect(result[0][1].key).toBe("s");
	});

	it("parses plus key literally", () => {
		const result = parseHotkey("+");
		expect(result[0][0].key).toBe("+");
		expect(result[0][0].ctrl).toBe(false);
	});

	it("parses 'plus' as + key", () => {
		const result = parseHotkey("Ctrl+plus");
		expect(result[0][0].ctrl).toBe(true);
		expect(result[0][0].key).toBe("+");
	});
});

describe("matchesKey", () => {
	function mockEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
		return {
			key: "a",
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			...overrides,
		} as KeyboardEvent;
	}

	it("matches simple key", () => {
		const [combo] = parseHotkey("a")[0];
		expect(matchesKey(mockEvent({ key: "a" }), combo)).toBe(true);
		expect(matchesKey(mockEvent({ key: "b" }), combo)).toBe(false);
	});

	it("matches with ctrl modifier", () => {
		const [combo] = parseHotkey("Ctrl+s")[0];
		expect(matchesKey(mockEvent({ key: "s", ctrlKey: true }), combo)).toBe(true);
		expect(matchesKey(mockEvent({ key: "s", ctrlKey: false }), combo)).toBe(false);
	});

	it("rejects extra modifiers", () => {
		const [combo] = parseHotkey("a")[0];
		expect(matchesKey(mockEvent({ key: "a", ctrlKey: true }), combo)).toBe(false);
	});

	it("case insensitive on key", () => {
		const [combo] = parseHotkey("a")[0];
		expect(matchesKey(mockEvent({ key: "A" }), combo)).toBe(true);
	});

	it("space key as 'space'", () => {
		const [combo] = parseHotkey("space")[0];
		expect(matchesKey(mockEvent({ key: " " }), combo)).toBe(true);
	});

	it("shifted chars imply shift", () => {
		const [combo] = parseHotkey("?")[0];
		expect(matchesKey(mockEvent({ key: "?", shiftKey: true }), combo)).toBe(true);
	});
});
