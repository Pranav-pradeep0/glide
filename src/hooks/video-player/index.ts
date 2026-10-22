/**
 * Video Player Hooks
 *
 * Modular hook-based architecture for the video player.
 * This index file re-exports all hooks and types for easy importing.
 */

// Core hooks
export { usePlayerCore, initialPlayerState } from './usePlayerCore';
export { usePlayerUI, anyPanelOpen } from './usePlayerUI';
export { usePlayerHUD } from './usePlayerHUD';

// Gesture hooks
export { usePlayerGestures } from './usePlayerGestures';
export { useSeekGesture } from './useSeekGesture';
export { useBrightnessGesture } from './useBrightnessGesture';
export { useVolumeGesture } from './useVolumeGesture';
export { useSpeedGesture } from './useSpeedGesture';
export { useZoomGesture } from './useZoomGesture';
export { useTapGestures } from './useTapGestures';

// Feature hooks
export { usePlayerTracks, hasSoundTag } from './usePlayerTracks';
export { usePlayerBookmarks } from './usePlayerBookmarks';
export { usePlayerSettings } from './usePlayerSettings';
export { useShakeControl, ShakeDetector } from './useShakeControl';
export { usePlayerRecap } from './usePlayerRecap';
export { useResumePlayback } from './useResumePlayback';
export { useTvRemote, useTvFocusScope, tvFocus, tvSeekTarget } from './useTvRemote';
export type { TvKeyEvent, TvKeyMode } from './useTvRemote';

// Types and utilities
export * from './types';
