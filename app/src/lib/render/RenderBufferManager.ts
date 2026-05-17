export interface RenderDelta {
	added: RenderEntry[];
	updated: RenderPatch[];
	removed: number[];
	colorPatches: ColorPatch[];
	fullReset?: boolean;
}

export interface RenderEntry {
	id: string;
	lng: number;
	lat: number;
	heading: number;
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface RenderPatch {
	renderIndex: number;
	lng?: number;
	lat?: number;
	heading?: number;
}

export interface ColorPatch {
	renderIndex: number;
	r: number;
	g: number;
	b: number;
	a: number;
}

const MIN_CAPACITY = 1024;

export class RenderBufferManager {
	ids: string[] = [];
	idToRenderIndex = new Map<string, number>();
	positions: Float32Array;
	colors: Uint8Array;
	angles: Float32Array;
	count = 0;
	capacity: number;
	version = 0;

	constructor(capacity = MIN_CAPACITY) {
		this.capacity = capacity;
		this.positions = new Float32Array(capacity * 2);
		this.colors = new Uint8Array(capacity * 4);
		this.angles = new Float32Array(capacity);
	}

	initFromBinary(buf: ArrayBuffer, count: number, _selCount: number) {
		const posOff = 8;
		const colOff = posOff + count * 8;
		const angOff = colOff + count * 4;

		this.ensureCapacity(count);
		this.count = count;

		const srcPos = new Float32Array(buf, posOff, count * 2);
		const srcCol = new Uint8Array(buf, colOff, count * 4);
		const srcAng = new Float32Array(buf, angOff, count);

		this.positions.set(srcPos);
		this.colors.set(srcCol);
		this.angles.set(srcAng);

		this.ids.length = 0;
		this.idToRenderIndex.clear();

		this.version++;
	}

	resolvePickIndex(index: number): string | null {
		if (index < 0 || index >= this.count) return null;
		return this.ids[index];
	}

	getLayerData() {
		return {
			length: this.count,
			attributes: {
				getPosition: { value: this.positions, size: 2 },
				getColor: { value: this.colors, size: 4 },
				getAngle: { value: this.angles, size: 1 },
			},
		};
	}

	applyDelta(delta: RenderDelta) {
		if (delta.removed.length > 0) {
			const sorted = [...delta.removed].sort((a, b) => b - a);
			for (const idx of sorted) this.swapRemove(idx);
		}

		if (delta.added.length > 0) {
			this.ensureCapacity(this.count + delta.added.length);
			for (const entry of delta.added) {
				const i = this.count;
				this.positions[i * 2] = entry.lng;
				this.positions[i * 2 + 1] = entry.lat;
				this.colors[i * 4] = entry.r;
				this.colors[i * 4 + 1] = entry.g;
				this.colors[i * 4 + 2] = entry.b;
				this.colors[i * 4 + 3] = entry.a;
				this.angles[i] = entry.heading;
				this.ids[i] = entry.id;
				this.idToRenderIndex.set(entry.id, i);
				this.count++;
			}
		}

		for (const patch of delta.updated) {
			const i = patch.renderIndex;
			if (i < 0 || i >= this.count) continue;
			if (patch.lng != null) this.positions[i * 2] = patch.lng;
			if (patch.lat != null) this.positions[i * 2 + 1] = patch.lat;
			if (patch.heading != null) this.angles[i] = patch.heading;
		}

		for (const cp of delta.colorPatches) {
			const i = cp.renderIndex;
			if (i < 0 || i >= this.count) continue;
			this.colors[i * 4] = cp.r;
			this.colors[i * 4 + 1] = cp.g;
			this.colors[i * 4 + 2] = cp.b;
			this.colors[i * 4 + 3] = cp.a;
		}

		this.version++;
	}

	private swapRemove(index: number) {
		const last = this.count - 1;
		if (last < 0) return;
		const removedId = this.ids[index];

		if (index !== last) {
			this.positions[index * 2] = this.positions[last * 2];
			this.positions[index * 2 + 1] = this.positions[last * 2 + 1];
			this.colors[index * 4] = this.colors[last * 4];
			this.colors[index * 4 + 1] = this.colors[last * 4 + 1];
			this.colors[index * 4 + 2] = this.colors[last * 4 + 2];
			this.colors[index * 4 + 3] = this.colors[last * 4 + 3];
			this.angles[index] = this.angles[last];

			const movedId = this.ids[last];
			this.ids[index] = movedId;
			this.idToRenderIndex.set(movedId, index);
		}

		this.idToRenderIndex.delete(removedId);
		this.count--;
	}

	private ensureCapacity(needed: number) {
		if (needed <= this.capacity) return;
		const newCap = Math.max(needed, this.capacity * 2, MIN_CAPACITY);
		const newPos = new Float32Array(newCap * 2);
		const newCol = new Uint8Array(newCap * 4);
		const newAng = new Float32Array(newCap);
		newPos.set(this.positions.subarray(0, this.count * 2));
		newCol.set(this.colors.subarray(0, this.count * 4));
		newAng.set(this.angles.subarray(0, this.count));
		this.positions = newPos;
		this.colors = newCol;
		this.angles = newAng;
		this.capacity = newCap;
	}

	clear() {
		this.count = 0;
		this.ids.length = 0;
		this.idToRenderIndex.clear();
		this.version++;
	}
}
