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

type Tile = { x: number; y: number };
type TileLayer = { id: string; tile: Tile; data: PanoDot[] | Promise<PanoDot[]> };

export default class PanoCoverageLayer extends CompositeLayer<Required<_PanoCoverageLayerProps>> {
	static layerName = "PanoCoverageLayer";
	static defaultProps = defaultProps;

	declare state: { layers: TileLayer[] };

	initializeState(): void {
		this.setState({ layers: [] });
	}

	shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
		return changeFlags.somethingChanged;
	}

	updateState({ context }: UpdateParameters<this>): void {
		if (context.viewport.zoom < this.props.minZoom) {
			if (this.state.layers.length) this.setState({ layers: [] });
			return;
		}
		const [west, south, east, north] = context.viewport.getBounds();
		const inView = boundsToTiles(west, south, east, north);
		const known = new Set(this.state.layers.map((l) => tileKey(l.tile)));
		if (inView.every((t) => known.has(tileKey(t)))) return;
		this.setState({
			layers: inView.map((t) => ({
				id: `${this.props.id}:${tileKey(t)}`,
				tile: t,
				data: fetchPanoDots(t),
			})),
		});
	}

	renderLayers() {
		const { color, scaled } = this.props;
		return this.state.layers.map(
			({ id, data }) =>
				new ScatterplotLayer<PanoDot>({
					id,
					data,
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
				}),
		);
	}
}
