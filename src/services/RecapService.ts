import { SubtitleCue } from '../types';
import { AI_PROXY_URL, RECAP_AVAILABLE } from '../utils/constants';
import { fetchWithTimeout } from '../utils/network';
import { SubtitleCueStore } from './SubtitleCueStore';
import { SubtitleTrack } from '../utils/SubtitleExtractor';

const RECAP_TIMEOUT_MS = 20000;

export class RecapService {
    private static readonly MIN_DIALOGUE_LINES = 4;
    private static readonly MIN_DIALOGUE_WORDS = 40;
    private static readonly MIN_DIALOGUE_DURATION_SECONDS = 12;
    private static readonly SCENE_GAP_SECONDS = 8;
    private static readonly MAX_LOOKBACK_SECONDS = 20 * 60;
    /** Matches MAX_DIALOGUE_CHARS in the proxy (~1200 tokens). */
    private static readonly MAX_DIALOGUE_CHARS = 5000;

    /**
     * High-level entry point to get dialogue for recap.
     * Checks existing cues first, then uses SubtitleCueStore to find/extract the best track.
     */
    static async getDialogueForRecap(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[],
        resumePosition: number,
        _videoTitle?: string
    ): Promise<string | null> {
        const cues = await this.getCuesForRecap(videoPath, tracks, existingCues);

        if (!cues || cues.length === 0) {
            if (__DEV__) { console.warn('[RecapService] No subtitles available for recap'); }
            return null;
        }

        const stats = this.getRecentDialogueStats(cues, resumePosition);
        if (!stats || !this.isDialogueSufficient(stats)) {
            if (__DEV__) { console.warn('[RecapService] Not enough dialogue for recap'); }
            return null;
        }

        return stats.dialogue;
    }

    static async getRecapEligibility(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[],
        resumePosition: number
    ): Promise<{ eligible: boolean; reason: 'no_subtitles' | 'insufficient_dialogue' | 'ok' }> {
        const cues = await this.getCuesForRecap(videoPath, tracks, existingCues);
        if (!cues || cues.length === 0) {
            return { eligible: false, reason: 'no_subtitles' };
        }

        const stats = this.getRecentDialogueStats(cues, resumePosition);
        if (!stats || !this.isDialogueSufficient(stats)) {
            return { eligible: false, reason: 'insufficient_dialogue' };
        }

        return { eligible: true, reason: 'ok' };
    }

    private static async getCuesForRecap(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[]
    ): Promise<SubtitleCue[] | null> {
        let cues = existingCues;

        // If no cues currently enabled, find the best track and extract
        if (!cues || cues.length === 0) {
            if (__DEV__) { console.log('[RecapService] No active cues, searching for best track...'); }
            const result = await SubtitleCueStore.getBestTrackCues(videoPath, tracks);
            if (result) {
                if (__DEV__) { console.log('[RecapService] Using track:', result.trackIndex); }
                cues = result.cues;
            }
        }

        return cues && cues.length > 0 ? cues : null;
    }

    /**
     * One line per speaker turn. SDH speaker labels are kept ("[Harlander] Thank you." becomes
     * "Harlander: Thank you."): they are the only way the model can tell who said what.
     * Sound labels like [thunder rumbles] or (SIGHS) are dropped.
     */
    static cleanCue(raw: string): string[] {
        return raw
            .replace(/<[^>]*>/g, '')
            .replace(/[[(]([A-Z][a-z][\w.'-]*(?:\s[A-Z][\w.'-]*){0,2})[\])]\s*(?=[^\s[(])/g, '$1: ')
            .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
            .split(/(?:^|\s)-\s+/) // "- Are you ill? - Thank you." is two speakers
            .map(s => s.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    }

    /**
     * Walks back from the pause until the proxy's character cap is full, so a quiet or
     * music-heavy stretch still gets enough story. The cost cap is the same either way.
     */
    private static getRecentDialogueStats(
        cues: SubtitleCue[],
        resumePosition: number
    ): { dialogue: string; lineCount: number; wordCount: number; durationSeconds: number } | null {
        const earliest = resumePosition - this.MAX_LOOKBACK_SECONDS;
        const recent = cues.filter(cue => cue.startTime >= earliest && cue.startTime <= resumePosition);

        let lineCount = 0;
        let wordCount = 0;
        let durationSeconds = 0;
        let chars = 0;
        const lines: string[] = []; // newest first, reversed at the end
        let nextStart = Infinity;

        for (let i = recent.length - 1; i >= 0; i--) {
            const cue = recent[i];
            const turns = this.cleanCue(cue.text);
            if (turns.length === 0) { continue; }

            const size = turns.join('\n').length + 1;
            if (chars + size > this.MAX_DIALOGUE_CHARS) { break; }

            // A long silence usually means a cut; a blank line tells the model a new scene began.
            if (nextStart - cue.endTime > this.SCENE_GAP_SECONDS && lines.length > 0) {
                lines.push('');
            }
            nextStart = cue.startTime;
            lines.push(...turns.reverse());
            chars += size;
            lineCount += 1;
            durationSeconds += Math.max(0, cue.endTime - cue.startTime);
            wordCount += turns.join(' ').split(/\s+/).length;
        }

        if (lineCount === 0) { return null; }
        return { dialogue: lines.reverse().join('\n'), lineCount, wordCount, durationSeconds };
    }

    private static isDialogueSufficient(stats: { lineCount: number; wordCount: number; durationSeconds: number }): boolean {
        return (
            stats.lineCount >= this.MIN_DIALOGUE_LINES &&
            stats.wordCount >= this.MIN_DIALOGUE_WORDS &&
            stats.durationSeconds >= this.MIN_DIALOGUE_DURATION_SECONDS
        );
    }

    static async generateRecap(dialogue: string, videoTitle?: string): Promise<string | null> {
        if (!dialogue) {
            if (__DEV__) { console.warn('[RecapService] No dialogue provided'); }
            return null;
        }

        if (!RECAP_AVAILABLE) {
            if (__DEV__) { console.warn('[RecapService] Recap unavailable: no AI proxy URL configured.'); }
            return null;
        }

        try {
            const response = await fetchWithTimeout(
                `${AI_PROXY_URL}/v1/recap`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({ dialogue, title: videoTitle ?? '' }),
                },
                RECAP_TIMEOUT_MS
            );

            if (!response.ok) {
                // Status only; never log dialogue or response bodies.
                if (__DEV__) { console.warn(`[RecapService] Proxy error ${response.status}`); }
                return null;
            }

            const data = await response.json() as { recap?: string };
            return data.recap?.trim() || null;
        } catch (error) {
            if (__DEV__) { console.error('[RecapService] Recap request failed:', error); }
            return null;
        }
    }

    /** Flags a recap as wrong or offensive (Play AI-content policy). Resolves false if it was not sent. */
    static async reportRecap(recap: string, videoTitle: string): Promise<boolean> {
        if (!RECAP_AVAILABLE) {return false;}
        try {
            const response = await fetchWithTimeout(`${AI_PROXY_URL}/v1/report`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ recap, title: videoTitle }),
            }, RECAP_TIMEOUT_MS);
            return response.ok;
        } catch {
            return false;
        }
    }
}
