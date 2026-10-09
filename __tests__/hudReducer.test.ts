import { describe, expect, it } from '@jest/globals';
import { hudReducer, initialHUDState } from '../src/hooks/video-player/usePlayerHUD';

// UPDATE_ZOOM returning a fresh object for an unchanged scale caused an unbounded
// render loop: new hud.state -> new hud object -> new resetZoom -> the effect that
// calls resetZoom re-fires -> repeat. Identity stability here is load-bearing, not
// a micro-optimisation.

describe('hudReducer UPDATE_ZOOM', () => {
  it('returns the identical state object when the scale has not changed', () => {
    const next = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: initialHUDState.zoom.scale });
    expect(next).toBe(initialHUDState);
  });

  it('is idempotent when dispatched repeatedly with the same scale', () => {
    const zoomed = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: 2 });
    const again = hudReducer(zoomed, { type: 'UPDATE_ZOOM', scale: 2 });
    expect(again).toBe(zoomed);
  });

  it('still produces new state for a genuinely different scale', () => {
    const next = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: 2.5 });
    expect(next).not.toBe(initialHUDState);
    expect(next.zoom.scale).toBe(2.5);
  });
});

// Hiding a HUD that is already hidden used to allocate a new state object, and
// showBrightnessHUD dispatches HIDE_VOLUME unconditionally -- so a brightness drag
// re-rendered the whole player once per frame for nothing.

describe('hudReducer HIDE actions', () => {
  it('returns the identical state when the HUD is already hidden', () => {
    for (const type of ['HIDE_SEEK', 'HIDE_BRIGHTNESS', 'HIDE_VOLUME', 'HIDE_SPEED', 'HIDE_RESIZE', 'HIDE_RIPPLE'] as const) {
      expect(hudReducer(initialHUDState, { type })).toBe(initialHUDState);
    }
  });

  it('still hides a HUD that is showing', () => {
    const shown = hudReducer(initialHUDState, { type: 'SHOW_VOLUME', value: 0.8 });
    const hidden = hudReducer(shown, { type: 'HIDE_VOLUME' });

    expect(shown.volume.show).toBe(true);
    expect(hidden.volume.show).toBe(false);
  });

  it('leaves the other HUDs untouched when one is hidden', () => {
    const shown = hudReducer(initialHUDState, { type: 'SHOW_BRIGHTNESS', value: 0.4 });
    expect(hudReducer(shown, { type: 'HIDE_VOLUME' })).toBe(shown);
  });
});
