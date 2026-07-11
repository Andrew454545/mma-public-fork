import { useEffect, useRef } from "react";

/** A stable debounced wrapper around `fn`. The returned function keeps a constant
 *  identity; the latest `fn`/`ms` are always used, and the pending timer is cancelled
 *  on unmount. With `flush: true`, the last pending call fires on unmount instead of
 *  being dropped (useful for color pickers where losing the final drag value is wrong). */
export function useDebouncedCallback<A extends unknown[]>(
	fn: (...args: A) => void,
	ms: number,
	opts?: { flush?: boolean },
): (...args: A) => void {
	const fnRef = useRef(fn);
	const msRef = useRef(ms);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastArgs = useRef<A | null>(null);
	fnRef.current = fn;
	msRef.current = ms;

	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
				if (opts?.flush && lastArgs.current) fnRef.current(...lastArgs.current);
			}
		},
		[],
	);

	return useRef((...args: A) => {
		lastArgs.current = args;
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			fnRef.current(...args);
		}, msRef.current);
	}).current;
}
