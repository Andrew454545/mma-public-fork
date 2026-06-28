import { useEffect } from "react";

export function useDomEvent(event: string, handler: (e: Event) => void) {
	useEffect(() => {
		document.addEventListener(event, handler);
		return () => document.removeEventListener(event, handler);
	}, [event, handler]);
}
