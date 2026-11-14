// src/services/SubtitleAutoSync.ts
//
// Automatic subtitle sync: align when people speak with when cues are shown. The maths is
// native (SubtitleAligner.kt): it reads ~10 MB of PCM, which the JS thread must not do.
// This file picks what to analyse and turns the answer into something safe to apply.

import { NativeModules } from 'react-native';
import { SubtitleCue } from '../types';

/**
 * Audio is analysed as [CLIPS] clips of [CLIP_S] seconds, one in each equal part of the film:
 * the true delay lines up in every clip and chance does not, so 8 minutes spread out beat one
 * 5-minute window (scripts/subsync-bench.py). The clips decode in parallel.
 */
export const CLIP_S = 60;
const CLIPS = 8;

/** A clip needs this many speech cues inside it to say anything. */
const MIN_CLIP_CUES = 5;

/** Longer cues are usually lyrics or captions held on screen, not a line being spoken. */
const MAX_SPEECH_CUE_S = 12;

export type AutoSyncResult =
    /** A cue at subtitle time c is shown at c * ratio + delayMs / 1000. Ratio is 1 for a plain delay. */
    | { kind: 'synced'; delayMs: number; ratio: number }
    | { kind: 'unsure' }
    | { kind: 'too-few-cues' }
    | { kind: 'no-audio' }
    | { kind: 'failed' };

/** Native's answer, only ever one safe to apply; null when unsure. */
interface NativeAlignment {
    delayMs: number;
    ratio: number;
    peakZ: number;
    runnerUp: number;
}

/**
 * Ideographs and kana, where one character is already a word ("嗯", "あ"). Explicit ranges, not
 * \p{...}: Jest runs on Node, so a property escape Hermes reads differently would pass the tests.
 */
const IDEOGRAPHIC = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/**
 * A cue someone speaks. Sound descriptions ("[door slams]", "(music)", Japanese "（笑）",
 * Chinese "【音乐】") and lyrics ("♪ ... ♪", "♬") are on screen while nobody talks, and would
 * pull the alignment toward noise.
 */
export function isSpeechCue(cue: SubtitleCue): boolean {
    if (cue.endTime - cue.startTime > MAX_SPEECH_CUE_S || cue.endTime <= cue.startTime) {return false;}
    if (/[♪♫♬♩]/.test(cue.text)) {return false;}
    const spoken = cue.text
        .replace(/<[^>]*>|\{[^}]*\}/g, '')      // HTML and ASS override tags
        // Sound descriptions, ASCII and full-width brackets alike
        .replace(/\[[^\]]*\]|\([^)]*\)|［[^］]*］|（[^）]*）|【[^】]*】|〔[^〕]*〕/g, '')
        // Spaces, digits and punctuation of any script: Latin, CJK, Arabic, Devanagari
        .replace(/[\s\d.,!?'"…:;\-–—¡¿«»“”‘’„。、，！？：；「」『』・〜～‥،؛؟।॥]/g, '');
    return spoken.length >= (IDEOGRAPHIC.test(spoken) ? 1 : 2);
}

/**
 * Where to listen: the start of the [CLIP_S] stretch with the most speech cues in each of
 * [CLIPS] equal parts of the dialogue, skipping parts with fewer than [MIN_CLIP_CUES]. Empty
 * unless at least two clips qualify.
 */
export function chooseClips(speechCues: SubtitleCue[]): number[] {
    const cues = [...speechCues].sort((a, b) => a.startTime - b.startTime);
    const span = cues.reduce((m, c) => Math.max(m, c.endTime), 0);
    const clips: number[] = [];
    for (let part = 0; part < CLIPS; part++) {
        // Never overlapping the last clip: the same audio twice would count as twice the evidence.
        const from = Math.max((span * part) / CLIPS, clips.length ? clips[clips.length - 1] + CLIP_S : 0);
        const to = Math.max(from, (span * (part + 1)) / CLIPS - CLIP_S);
        let best = -1;
        let bestCount = 0;
        for (let t = from; t <= to; t += 5) {
            const count = cues.filter(c => c.startTime >= t && c.endTime <= t + CLIP_S).length;
            if (count > bestCount) { best = t; bestCount = count; }
        }
        if (bestCount >= MIN_CLIP_CUES) {clips.push(best);}
    }
    return clips.length >= 2 ? clips : [];
}

/** What to do with the native answer: native only answers when it is safe to apply, ratio and all. */
export function interpret(alignment: NativeAlignment | null): AutoSyncResult {
    if (!alignment) {return { kind: 'unsure' };}
    return { kind: 'synced', delayMs: Math.round(alignment.delayMs / 10) * 10, ratio: alignment.ratio || 1 };
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
        audioFormatId?: string,
    ): Promise<AutoSyncResult> {
        const speech = cues.filter(isSpeechCue);
        const clips = chooseClips(speech);
        if (clips.length === 0) {return { kind: 'too-few-cues' };}

        const starts = speech.map(c => c.startTime);
        const ends = speech.map(c => c.endTime);

        if (NativeModules.SubtitleSyncModule?.alignVideo) {
            try {
                // The numbers behind the answer are logged natively (SubtitleSyncModule, "auto-sync").
                const alignment: NativeAlignment | null = await NativeModules.SubtitleSyncModule.alignVideo(
                    videoPath,
                    clips,
                    CLIP_S,
                    starts,
                    ends,
                    audioFormatId ?? null,
                    positionS,
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
