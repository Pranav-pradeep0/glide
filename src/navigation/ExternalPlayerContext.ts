import { createContext, useContext } from 'react';

/** True inside VideoPlayerActivity's tree: a video another app opened, which may want its stop point back. */
export const ExternalPlayerContext = createContext(false);

/**
 * The Activity hosting this player tree. Both trees share one JS runtime, so native calls that
 * touch a window (brightness, rotation, PiP state) name their own rather than the one in front.
 */
export function usePlayerActivity(): 'VideoPlayerActivity' | 'MainActivity' {
    return useContext(ExternalPlayerContext) ? 'VideoPlayerActivity' : 'MainActivity';
}
