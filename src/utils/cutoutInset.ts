/** A camera cutout's bounds in dp, window coordinates (VideoOrientation.getCutoutRects). */
export interface CutoutRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * How far in from one edge a control must sit to clear the cutout, given the vertical band
 * (`top`..`bottom`, dp) it occupies. A punch hole moves only the controls level with it; a
 * notch as tall as the screen moves everything on that edge.
 *
 * `inset` is the safe-area inset on that side. Deeper than any cutout there, the rest is a
 * side navigation bar, which every control on the edge clears. With no rects known (an APK
 * before API 9, or not measured yet) the whole inset applies, as it did before.
 */
export function cutoutInset(
    side: 'left' | 'right',
    inset: number,
    rects: CutoutRect[] | null,
    windowWidth: number,
    top: number,
    bottom: number,
): number {
    if (!rects) { return inset; }
    const onSide = rects.filter(r => (side === 'left' ? r.right <= windowWidth / 2 : r.left >= windowWidth / 2));
    const depth = (r: CutoutRect) => (side === 'left' ? r.right : windowWidth - r.left);
    if (inset > Math.max(0, ...onSide.map(depth)) + 1) { return inset; }
    return Math.max(0, ...onSide.filter(r => r.top < bottom && r.bottom > top).map(depth));
}
