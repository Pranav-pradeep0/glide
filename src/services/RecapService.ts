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

    /**
     * Extracts dialogue from the last few minutes (e.g., 5 mins) before the resume position.
     * Balanced for quality and token usage.
     */
    static getRecentDialogue(cues: SubtitleCue[], resumePosition: number, windowSeconds: number = 300): string {
        const stats = this.getRecentDialogueStats(cues, resumePosition, windowSeconds);
        return stats?.dialogue || '';
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

    private static getRecentDialogueStats(
        cues: SubtitleCue[],
        resumePosition: number,
        windowSeconds: number = 300
    ): { dialogue: string; lineCount: number; wordCount: number; durationSeconds: number } | null {
        const startTime = Math.max(0, resumePosition - windowSeconds);
        const relevantCues = cues.filter(
            cue => cue.startTime >= startTime && cue.startTime <= resumePosition
        );

        if (relevantCues.length === 0) { return null; }

        let lineCount = 0;
        let wordCount = 0;
        let durationSeconds = 0;
        const processedCues: string[] = [];

        for (const cue of relevantCues) {
            // Remove HTML-like tags
            let text = cue.text.replace(/<[^>]*>/g, '');
            // Remove bracketed noise like [MUSIC], (SIGHS), [Door Slams]
            text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, '');
            text = text.trim();

            if (!text) { continue; }

            processedCues.push(text);
            lineCount += 1;
            durationSeconds += Math.max(0, cue.endTime - cue.startTime);
            wordCount += text.split(/\s+/).filter(Boolean).length;
        }

        if (processedCues.length === 0) { return null; }

        let dialogue = processedCues.join(' ');

        // Limit to roughly 1000-1200 tokens (~5000 characters)
        // We take the LATEST part if it's too long, but try to cut at a sentence boundary
        if (dialogue.length > 5000) {
            const truncated = dialogue.substring(dialogue.length - 5000);
            // Find first space to avoid cutting a word
            const firstSpace = truncated.indexOf(' ');
            dialogue = firstSpace !== -1 ? truncated.substring(firstSpace).trim() : truncated;
        }

        return { dialogue, lineCount, wordCount, durationSeconds };
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
