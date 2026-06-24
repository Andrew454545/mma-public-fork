import { CompositeLayer } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { boundsToTiles, fetchPanoDots, tileKey, type PanoDot } from "@/lib/geo/photometa";
import type { CompositeLayerProps, Color, DefaultProps, UpdateParameters } from "@deck.gl/core";

type _PanoCoverageLayerProps = {
	color?: Color;
	// radius in meters (grows when zoomed in) vs. a constant on-screen pixel size
	scaled?: boolean;
	minZoom?: number;
};

export type PanoCoverageLayerProps = _PanoCoverageLayerProps & CompositeLayerProps;

const defaultProps: DefaultProps<PanoCoverageLayerProps> = {
	color: [255, 0, 0],
	scaled: false,
	minZoom: 14.9,
};

const MAX_TILES = 1024;

export default class PanoCoverageLayer extends CompositeLayer<Required<_PanoCoverageLayerProps>> {
	static layerName = "PanoCoverageLayer";
	static defaultProps = defaultProps;

	// tiles: insertion order is age (oldest first); dots is the flattened render array,
	// rebuilt only when tiles change so the ScatterplotLayer data ref stays stable per frame.
	declare state: { tiles: Map<string, PanoDot[]>; dots: PanoDot[]; show: boolean };

	initializeState(): void {
		this.setState({ tiles: new Map(), dots: [], show: false });
	}

	shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
		return changeFlags.somethingChanged;
	}

	updateState({ context }: UpdateParameters<this>): void {
		const { minZoom } = this.props;

		if (context.viewport.zoom < minZoom) {
			if (this.state.show) this.setState({ show: false });
			return;
		}

		const [west, south, east, north] = context.viewport.getBounds();
		const inView = boundsToTiles(west, south, east, north);
		const known = this.state.tiles;
		const fresh = inView.filter((t) => !known.has(tileKey(t)));
		if (this.state.show && fresh.length === 0) return; // nothing new in view

		const tiles = new Map(known);
		for (const t of fresh) tiles.set(tileKey(t), []);
		this.evict(tiles, new Set(inView.map(tileKey)));
		this.commit(tiles, true);

		for (const t of fresh) {
			const key = tileKey(t);
			fetchPanoDots(t).then((d) => {
				if (!d.length || !this.state.tiles.has(key)) return; // evicted mid-fetch
				const next = new Map(this.state.tiles);
				next.set(key, d);
				this.commit(next, this.state.show);
			});
		}
	}

	// Drop oldest tiles outside the current view until under the cap.
	private evict(tiles: Map<string, PanoDot[]>, keep: Set<string>): void {
		for (const key of tiles.keys()) {
			if (tiles.size <= MAX_TILES) break;
			if (!keep.has(key)) tiles.delete(key);
		}
	}

	private commit(tiles: Map<string, PanoDot[]>, show: boolean): void {
		let dots: PanoDot[] = [];
		for (const arr of tiles.values()) dots = dots.concat(arr);
		this.setState({ tiles, dots, show });
	}

	renderLayers() {
		if (!this.state.show) return [];
		const { color, scaled } = this.props;
		return new ScatterplotLayer<PanoDot>({
			id: `${this.props.id}-dots`,
			data: this.state.dots,
			getPosition: (d: PanoDot) => [d.lng, d.lat],
			getFillColor: color,
			radiusUnits: scaled ? "meters" : "pixels",
			getRadius: scaled ? 2 : 4,
			radiusMaxPixels: scaled ? 24 : 4,
			stroked: false,
			filled: true,
			opacity: 0.7,
			pickable: false,
			updateTriggers: { getFillColor: color },
		});
	}
}
