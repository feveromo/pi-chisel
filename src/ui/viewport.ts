export interface ViewportSlice<T> {
	items: T[];
	offset: number;
	total: number;
	hasOverflow: boolean;
}

export function clampViewportOffset(
	requestedOffset: number,
	total: number,
	viewportSize: number,
): number {
	const maximum = Math.max(0, total - Math.max(1, viewportSize));
	return Math.max(0, Math.min(maximum, Math.trunc(requestedOffset)));
}

export function sliceViewport<T>(
	items: readonly T[],
	requestedOffset: number,
	viewportSize: number,
): ViewportSlice<T> {
	const size = Math.max(1, Math.trunc(viewportSize));
	const offset = clampViewportOffset(requestedOffset, items.length, size);
	return {
		items: items.slice(offset, offset + size),
		offset,
		total: items.length,
		hasOverflow: items.length > size,
	};
}
