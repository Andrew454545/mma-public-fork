import { useEffect, useRef } from "react";

export function FpsCounter() {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let frames = 0;
		let last = performance.now();
		let rafId = 0;
		const tick = () => {
			frames++;
			const now = performance.now();
			if (now - last >= 1000) {
				if (ref.current) ref.current.textContent = `${frames} fps`;
				frames = 0;
				last = now;
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, []);
	return <span ref={ref} style={{ fontWeight: 700 }} />;
}
