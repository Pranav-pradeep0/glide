/**
 * The TV remote in the video player (TvRemoteModule, native).
 *
 * Stock React Native has no TV key events, so the Activity hands keys to the native module
 * first. The player tells it ahead of time which keys are its own (see TvKeyMode), so focus
 * moves without a round trip to JS, and only the player's keys come here. Overlays (panels,
 * modals, cards) declare themselves with useTvFocusScope: focus goes in when one opens, stays
 * inside while it is open, and returns to whatever opened it when it closes.
 *
 * Everything here is a no-op off TV.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { DeviceEventEmitter, NativeModules, findNodeHandle } from 'react-native';
import { IS_TV } from '@/utils/tv';

const { TvRemoteModule } = NativeModules;

/**
 * - off: every key is the system's.
 * - hidden: controls hidden; the D-pad is the player's (OK, arrows), nothing moves focus.
 * - focus: controls up; the D-pad moves focus within the screen, Left / Right scrub on the seek bar.
 *
 * Fast forward, rewind, next and previous are the player's in both; play / pause stays the
 * media session's, and arrives here unconsumed.
 */
export type TvKeyMode = 'off' | 'hidden' | 'focus';
const MODES: Record<TvKeyMode, number> = { off: 0, hidden: 1, focus: 2 };

export type TvKey =
    | 'up' | 'down' | 'left' | 'right' | 'center'
    | 'fastForward' | 'rewind' | 'next' | 'previous' | 'playPause';

export interface TvKeyEvent {
    key: TvKey;
    action: 'down' | 'up';
    /** Auto-repeat count while held; 0 for the first press. */
    repeat: number;
    /** False: the key went on to the focus system or the media session; this is just a heads-up. */
    consumed: boolean;
}

/** One press of Left / Right, as on Google TV and YouTube. */
export const TV_SEEK_SECONDS = 10;

/**
 * Where a remote seek lands after one more key event. Held, it speeds up: 1.5 s a repeat,
 * growing to 15 s after about 7 s of holding.
 * ponytail: counts repeats, so the speed follows the remote's repeat rate (~20/s); time it if remotes differ.
 */
export function tvSeekTarget(from: number, direction: 1 | -1, repeat: number, duration: number): number {
    const step = repeat === 0 ? TV_SEEK_SECONDS : Math.min(15, 1.5 + repeat * 0.1);
    return Math.max(0, Math.min(duration, from + direction * step));
}

const tagOf = (ref?: RefObject<unknown>): number => {
    const tag = ref?.current ? findNodeHandle(ref.current as any) : null;
    return tag ?? -1;
};

/** Focus this view (or the first focusable one inside it). */
export function tvFocus(ref: RefObject<unknown>) {
    if (!IS_TV) { return; }
    const tag = tagOf(ref);
    if (tag !== -1) { TvRemoteModule?.focus(tag); }
}

/**
 * While `open`, focus stays inside `ref`'s view; it starts on `focusRef` (or the first focusable
 * view inside `ref`). Give the view collapsable={false}, even with a background: without it Fabric
 * mounts its children into an ancestor, so nothing is "inside" it and focus can't be kept there.
 */
export function useTvFocusScope(ref: RefObject<unknown>, open: boolean, focusRef?: RefObject<unknown>) {
    useEffect(() => {
        if (!IS_TV || !open) { return; }
        const tag = tagOf(ref);
        if (tag === -1) { return; }
        TvRemoteModule?.pushScope(tag, tagOf(focusRef));
        return () => TvRemoteModule?.popScope(tag);
    }, [open, ref, focusRef]);
}

/** The screen that set the mode last owns it: a player replacing another mounts before the old one unmounts. */
let owner = 0;

interface UseTvRemoteOptions {
    mode: TvKeyMode;
    /** Focus never leaves this view. */
    screenRef: RefObject<unknown>;
    /** Left / Right here scrub instead of moving focus. */
    seekBarRef: RefObject<unknown>;
    /** Where focus starts when nothing in the screen has it. */
    homeRef: RefObject<unknown>;
    onKey: (e: TvKeyEvent) => void;
}

export function useTvRemote({ mode, screenRef, seekBarRef, homeRef, onKey }: UseTvRemoteOptions) {
    const onKeyRef = useRef(onKey);
    onKeyRef.current = onKey;
    const meRef = useRef(-1);

    useEffect(() => {
        if (!IS_TV || mode === 'off') { return; }
        const me = ++owner;
        meRef.current = me;
        TvRemoteModule?.setMode(MODES[mode], tagOf(screenRef), tagOf(seekBarRef), tagOf(homeRef));
        return () => {
            meRef.current = -1;
            if (owner === me) { TvRemoteModule?.setMode(MODES.off, -1, -1, -1); }
        };
    }, [mode, screenRef, seekBarRef, homeRef]);

    useEffect(() => {
        if (!IS_TV) { return; }
        const sub = DeviceEventEmitter.addListener('onTvRemoteKey', (e: TvKeyEvent) => {
            if (meRef.current === owner) { onKeyRef.current(e); }
        });
        return () => sub.remove();
    }, []);
}
