export async function runConcurrent<T>(
	items: T[],
	fn: (item: T, index: number) => Promise<void>,
	opts: { concurrency: number; signal?: AbortSignal },
): Promise<void> {
	let next = 0;
	async function worker() {
		while (next < items.length) {
			opts.signal?.throwIfAborted();
			const i = next++;
			await fn(items[i], i);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(opts.concurrency, items.length) }, () => worker()),
	);
}
