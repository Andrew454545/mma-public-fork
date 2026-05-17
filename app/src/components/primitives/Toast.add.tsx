import { useSyncExternalStore } from "react";

interface ToastEntry {
	id: number;
	message: string;
}

let toasts: ToastEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function notify() {
	for (const fn of listeners) fn();
}

export function toast(message: string, duration = 2500) {
	const id = nextId++;
	toasts = [...toasts, { id, message }];
	notify();
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id);
		notify();
	}, duration);
}

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function getSnapshot() {
	return toasts;
}

export function ToastContainer() {
	const entries = useSyncExternalStore(subscribe, getSnapshot);
	if (entries.length === 0) return null;
	return (
		<div className="toast-container">
			{entries.map((t) => (
				<div key={t.id} className="toast-entry">
					{t.message}
				</div>
			))}
		</div>
	);
}
