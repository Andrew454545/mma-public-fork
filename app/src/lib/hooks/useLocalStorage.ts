import { useState, useCallback } from "react";

export function useLocalStorage<T>(
	key: string,
	defaultValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
	const [value, setValue] = useState<T>(() => {
		try {
			const stored = localStorage.getItem(key);
			return stored !== null ? JSON.parse(stored) : defaultValue;
		} catch {
			return defaultValue;
		}
	});

	const set = useCallback(
		(v: T | ((prev: T) => T)) => {
			setValue((prev) => {
				const next = typeof v === "function" ? (v as (prev: T) => T)(prev) : v;
				localStorage.setItem(key, JSON.stringify(next));
				return next;
			});
		},
		[key],
	);

	return [value, set];
}
