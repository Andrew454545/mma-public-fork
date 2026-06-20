import { useEffect, useState } from "react";
import { subscribeMany, type EditorEvent } from "@/lib/events";
import { useLatestRef } from "@/lib/hooks/useLatestRef";

/** Run `handler` whenever any of `events` fires, for the component's lifetime.
 *  The latest `handler` is always used (no re-subscribe on identity change), so
 *  `events` should be a stable reference — e.g. one of the exported group constants. */
export function useEditorEvents(events: readonly EditorEvent[], handler: () => void): void {
	const ref = useLatestRef(handler);
	useEffect(() => subscribeMany(events, () => ref.current()), [events, ref]);
}

/** A counter that bumps whenever any of `events` fires. Drop it into a deps array
 *  to re-run an effect or `useAsync` when that editor state changes. */
export function useEventVersion(events: readonly EditorEvent[]): number {
	const [version, setVersion] = useState(0);
	useEditorEvents(events, () => setVersion((v) => v + 1));
	return version;
}
