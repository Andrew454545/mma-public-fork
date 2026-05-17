import { useEffect, useRef, useCallback } from "react";

const IS_MAC = /Mac|iPod|iPhone|iPad/i.test(navigator.platform);

interface ParsedKey {
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
	shift: boolean;
	key: string;
}

function parseCombo(combo: string): ParsedKey {
	if (combo === "+") {
		return { ctrl: false, alt: false, meta: false, shift: false, key: "+" };
	}
	const parts = combo.split("+");
	const parsed: ParsedKey = { ctrl: false, alt: false, meta: false, shift: false, key: "" };
	for (const p of parts) {
		const lower = p.toLowerCase();
		if (lower === "mod" || lower === "control" || lower === "ctrl") {
			if (IS_MAC) parsed.meta = true;
			else parsed.ctrl = true;
		} else if (lower === "alt") {
			parsed.alt = true;
		} else if (lower === "meta") {
			parsed.meta = true;
		} else if (lower === "shift") {
			parsed.shift = true;
		} else if (lower === "plus") {
			parsed.key = "+";
		} else {
			parsed.key = lower;
		}
	}
	return parsed;
}

export function parseHotkey(hotkeyStr: string): ParsedKey[][] {
	return hotkeyStr.split(",").map((alt) =>
		alt
			.trim()
			.split(" ")
			.map((combo) => parseCombo(combo.trim())),
	);
}

const SHIFTED_CHARS = new Set('?!@#$%^&*()_+{}|:"<>~');

export function matchesKey(e: KeyboardEvent, pk: ParsedKey): boolean {
	const ctrl = e.ctrlKey;
	const alt = e.altKey;
	const meta = e.metaKey;
	const shift = e.shiftKey;
	let key = e.key.toLowerCase();
	if (key === " ") key = "space";
	if (key === "=") key = "+";

	const shiftImplied = SHIFTED_CHARS.has(pk.key) || SHIFTED_CHARS.has(e.key);

	return (
		ctrl === pk.ctrl &&
		alt === pk.alt &&
		meta === pk.meta &&
		(shiftImplied || shift === pk.shift) &&
		key === pk.key
	);
}

export function isEditableElement(el: EventTarget | null): boolean {
	if (!(el instanceof HTMLElement)) return false;
	const tag = el.tagName.toLowerCase();
	const type = (el.getAttribute("type") ?? "").toLowerCase();
	return (
		tag === "select" ||
		tag === "textarea" ||
		(tag === "input" &&
			type !== "submit" &&
			type !== "reset" &&
			type !== "checkbox" &&
			type !== "radio" &&
			type !== "file") ||
		el.isContentEditable
	);
}

export function useHotkey(
	hotkey: string,
	callback: (e: KeyboardEvent) => void,
	options: { enableInInputs?: boolean } = {},
) {
	const cbRef = useRef(callback);
	cbRef.current = callback;
	const parsed = useRef(parseHotkey(hotkey));

	useEffect(() => {
		parsed.current = parseHotkey(hotkey);
	}, [hotkey]);

	useEffect(() => {
		function handler(e: KeyboardEvent) {
			if (e.defaultPrevented) return;
			if (!options.enableInInputs && isEditableElement(e.target)) return;

			for (const alt of parsed.current) {
				if (alt.length === 1 && matchesKey(e, alt[0])) {
					e.preventDefault();
					cbRef.current(e);
					return;
				}
			}
		}
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [options.enableInInputs]);
}

export function useHoldHotkey(hotkey: string, onHold: () => void, onRelease?: () => void) {
	const cbRef = useRef(onHold);
	cbRef.current = onHold;
	const releaseRef = useRef(onRelease);
	releaseRef.current = onRelease;
	const parsed = useRef(parseHotkey(hotkey));

	useEffect(() => {
		parsed.current = parseHotkey(hotkey);
	}, [hotkey]);

	useEffect(() => {
		let held = false;
		let rafId = 0;

		function tick() {
			if (!held) {
				rafId = 0;
				return;
			}
			cbRef.current();
			rafId = requestAnimationFrame(tick);
		}

		function onKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || e.repeat) return;
			if (isEditableElement(e.target)) return;
			for (const alt of parsed.current) {
				if (alt.length === 1 && matchesKey(e, alt[0])) {
					held = true;
					if (!rafId) rafId = requestAnimationFrame(tick);
					return;
				}
			}
		}

		function onKeyUp(e: KeyboardEvent) {
			if (!held) return;
			for (const alt of parsed.current) {
				if (alt.length === 1 && e.key.toLowerCase() === alt[0].key) {
					held = false;
					releaseRef.current?.();
					return;
				}
			}
		}

		function onBlur() {
			held = false;
		}

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, []);
}

export function useHotkeyRef<T extends HTMLElement = HTMLButtonElement>(
	hotkey: string,
	options: { enableInInputs?: boolean } = {},
) {
	const ref = useRef<T>(null);
	useHotkey(
		hotkey,
		useCallback(() => {
			ref.current?.click();
		}, []),
		options,
	);
	return ref;
}
