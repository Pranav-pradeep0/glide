import { createContext } from 'react';

/** True inside VideoPlayerActivity's tree: a video another app opened, which may want its stop point back. */
export const ExternalPlayerContext = createContext(false);
