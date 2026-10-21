// src/services/SubtitleAutoSync.ts
//
// Automatic subtitle sync: align when people speak with when cues are shown. The maths is
// native (SubtitleAligner.kt): it reads ~10 MB of PCM, which the JS thread must not do.
// This file picks what to analyse and turns the answer into something safe to apply.

import { NativeModules } from 'react-native';
import { SubtitleCue } from '../types';

/** Audio analysed per run. Minutes of evidence, not seconds, is what makes this robust. */
export const WINDOW_S = 300;

/** The window is chosen near where the viewer is, since an edit can shift sync mid-film. */
const SEARCH_AROUND_S = 900;

/**
 * How far the second window must be from the first. A frame-rate ratio is confirmed by two
 * windows agreeing on it; at a ratio 0.1% wrong they then disagree by >= 1.2 s.
 */
const SECOND_WINDOW_GAP_S = 1200;

/** Below this many speech cues in the window there is too little pattern to align. */
const MIN_SPEECH_CUES = 25;

/** Longer cues are usually lyrics or captions held on screen, not a line being spoken. */
const MAX_SPEECH_CUE_S = 12;

export type AutoSyncResult =
    /** A cue at subtitle time c is shown at c * ratio + delayMs / 1000. Ratio is 1 for a plain delay. */
    | { kind: 'synced'; delayMs: number; ratio: number }
    | { kind: 'drift' }
    | { kind: 'unsure' }
    | { kind: 'too-few-cues' }
    | { kind: 'no-audio' }
    | { kind: 'failed' };

interface NativeAlignment {
    delayMs: number;
    ratio: number;
    peakZ: number;
    runnerUp: number;
    confident: boolean;
    drift: boolean;
    source: 'energy' | 'speech';
}

/**
 * A cue someone speaks. Sound descriptions ("[door slams]", "(music)") and lyrics ("♪ ... ♪")
 * are on screen while nobody talks, and would pull the alignment toward noise.
 */
export function isSpeechCue(cue: SubtitleCue): boolean {
    if (cue.endTime - cue.startTime > MAX_SPEECH_CUE_S || cue.endTime <= cue.startTime) {return false;}
    if (/[♪♫]/.test(cue.text)) {return false;}
    const spoken = cue.text
        .replace(/<[^>]*>|\{[^}]*\}/g, '')      // HTML and ASS override tags
        .replace(/\[[^\]]*\]|\([^)]*\)/g, '')   // sound descriptions
        .replace(/[\s\d.,!?'"…:;\-–—]/g, '');
    return spoken.length >= 2;
}

/**
 * The 5-minute stretch with the most speech cues, within [SEARCH_AROUND_S] of the viewer.
 * Returns its start in seconds, or null if nowhere has enough dialogue.
 */
export function chooseWindow(speechCues: SubtitleCue[], positionS: number): number | null {
    const cues = [...speechCues].sort((a, b) => a.startTime - b.startTime);
    let best: { start: number; count: number } | null = null;
    let hi = 0;
    for (let lo = 0; lo < cues.length; lo++) {
        const start = Math.max(0, cues[lo].startTime - 20);
        if (Math.abs(start - positionS) > SEARCH_AROUND_S) {continue;}
        hi = Math.max(hi, lo);
        while (hi < cues.length && cues[hi].endTime <= start + WINDOW_S) {hi++;}
        const count = hi - lo;
        const closer = best !== null && Math.abs(start - positionS) < Math.abs(best.start - positionS);
        if (best === null || count > best.count || (count === best.count && closer)) {
            best = { start, count };
        }
    }
    return best !== null && best.count >= MIN_SPEECH_CUES ? best.start : null;
}

/**
 * The densest 5-minute stretch anywhere in the film at least [SECOND_WINDOW_GAP_S] from the
 * first window, for native to confirm a frame-rate ratio against. Null if there is none.
 */
export function chooseSecondWindow(speechCues: SubtitleCue[], firstStartS: number): number | null {
    const cues = [...speechCues].sort((a, b) => a.startTime - b.startTime);
    let best: { start: number; count: number } | null = null;
    let hi = 0;
    for (let lo = 0; lo < cues.length; lo++) {
        const start = Math.max(0, cues[lo].startTime - 20);
        if (Math.abs(start - firstStartS) < SECOND_WINDOW_GAP_S) {continue;}
        hi = Math.max(hi, lo);
        while (hi < cues.length && cues[hi].endTime <= start + WINDOW_S) {hi++;}
        if (best === null || hi - lo > best.count) {best = { start, count: hi - lo };}
    }
    return best !== null && best.count >= MIN_SPEECH_CUES ? best.start : null;
}

/** What to do with the native answer. Only a confident one is ever applied, ratio and all. */
export function interpret(alignment: NativeAlignment | null): AutoSyncResult {
    if (!alignment) {return { kind: 'unsure' };}
    if (alignment.confident) {
        return { kind: 'synced', delayMs: Math.round(alignment.delayMs / 10) * 10, ratio: alignment.ratio || 1 };
    }
    // A ratio fits but a second window could not confirm it: applying it could make things worse.
    return { kind: alignment.drift ? 'drift' : 'unsure' };
}

export class SubtitleAutoSync {
    /**
     * Work out the subtitle delay and frame-rate ratio for [cues] against [videoPath]'s audio.
     * Never applies anything itself: the caller decides, so a stale or unsure answer can be
     * dropped whole.
     */
    static async compute(
        videoPath: string,
        cues: SubtitleCue[],
        positionS: number,
        audioTrackIndex: number = -1,
    ): Promise<AutoSyncResult> {
        const speech = cues.filter(isSpeechCue);
        const windowStart = chooseWindow(speech, positionS);
        if (windowStart === null) {return { kind: 'too-few-cues' };}
        const secondStart = chooseSecondWindow(speech, windowStart);

        const starts = speech.map(c => c.startTime);
        const ends = speech.map(c => c.endTime);

        if (NativeModules.SubtitleSyncModule?.alignVideo) {
            try {
                // The numbers behind the answer are logged natively (SubtitleSyncModule, "auto-sync").
                const alignment: NativeAlignment | null = await NativeModules.SubtitleSyncModule.alignVideo(
                    videoPath,
                    windowStart,
                    starts,
                    ends,
                    Number.isInteger(audioTrackIndex) ? audioTrackIndex : -1,
                    secondStart ?? -1,
                );
                return interpret(alignment);
            } catch (error: any) {
                console.warn('[SubtitleAutoSync] Alignment failed:', error);
                return { kind: error?.code === 'E_NO_AUDIO' ? 'no-audio' : 'failed' };
            }
        }

        return { kind: 'failed' };
    }
}
