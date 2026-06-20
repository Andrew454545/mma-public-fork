import { useRef, type RefObject } from "react";

/** A ref that always holds the latest `value` */
export function useLatestRef<T>(value: T): RefObject<T> {
	const ref = useRef(value);
	ref.current = value;
	return ref;
}
