import { useState, useCallback, useEffect, useRef } from "react";

export function SearchControl({
	onResult,
}: {
	onResult: (lat: number, lng: number, name: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const search = useCallback((q: string) => {
		if (q.length < 3) {
			setResults([]);
			return;
		}
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(async () => {
			try {
				const res = await fetch(
					`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
					{ headers: { "Accept-Language": "en" } },
				);
				if (!res.ok) return;
				const data = await res.json();
				setResults(
					data.map((r: { display_name: string; lat: string; lon: string }) => ({
						name: r.display_name,
						lat: parseFloat(r.lat),
						lng: parseFloat(r.lon),
					})),
				);
				setIsOpen(data.length > 0);
			} catch {
				// ignored
			}
		}, 300);
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [isOpen]);

	return (
		<div
			className="map-control search-control"
			ref={containerRef}
			aria-expanded={isOpen}
			style={{ position: "relative" }}
		>
			<input
				className="search-control__input"
				placeholder="Search for places…"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					search(e.target.value);
				}}
				onFocus={() => results.length > 0 && setIsOpen(true)}
			/>
			<ol
				className="search-results"
				hidden={!isOpen || results.length === 0}
				style={{ top: "40px", zIndex: 10 }}
			>
				{results.map((r, i) => {
					const parts = r.name
						.split(",")
						.map((s: string) => s.trim())
						.filter(Boolean);
					const primary = parts[0];
					const context = parts.slice(1).join(", ");
					return (
						<li key={i}>
							<button
								className="search-result"
								onClick={() => {
									onResult(r.lat, r.lng, r.name);
									setQuery(primary);
									setIsOpen(false);
								}}
							>
								<strong>{primary}</strong>
								{context && (
									<>
										<br />
										<span className="search-result__context">{context}</span>
									</>
								)}
							</button>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
