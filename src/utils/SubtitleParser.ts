import { SubtitleCue } from '../types';
import { SubtitleHtmlParser } from './SubtitleHtmlParser';

export class SubtitleParser {
    // Parse SRT format
    static parseSRT(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const blocks = content.trim().split(/\n\s*\n/);

        blocks.forEach((block) => {
            const lines = block.trim().split('\n');
            if (lines.length < 3) { return; }

            const index = parseInt(lines[0], 10);
            const timeMatch = lines[1].match(
                /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
            );

            if (!timeMatch) { return; }

            const startTime =
                parseInt(timeMatch[1], 10) * 3600 +
                parseInt(timeMatch[2], 10) * 60 +
                parseInt(timeMatch[3], 10) +
                parseInt(timeMatch[4], 10) / 1000;

            const endTime =
                parseInt(timeMatch[5], 10) * 3600 +
                parseInt(timeMatch[6], 10) * 60 +
                parseInt(timeMatch[7], 10) +
                parseInt(timeMatch[8], 10) / 1000;

            const text = SubtitleHtmlParser.normalizeSubtitleText(lines.slice(2).join('\n'));
            const soundEffect = SubtitleParser.extractSoundEffect(text);

            cues.push({ index, startTime, endTime, text, soundEffect });
        });

        return cues;
    }

    // Parse WebVTT format
    static parseVTT(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const lines = content.split('\n');
        let index = 0;
        let i = 0;

        // Skip WEBVTT header
        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }

        while (i < lines.length) {
            const line = lines[i].trim();

            if (line.includes('-->')) {
                const timeMatch = line.match(
                    /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
                );

                if (timeMatch) {
                    const startTime =
                        parseInt(timeMatch[1], 10) * 3600 +
                        parseInt(timeMatch[2], 10) * 60 +
                        parseInt(timeMatch[3], 10) +
                        parseInt(timeMatch[4], 10) / 1000;

                    const endTime =
                        parseInt(timeMatch[5], 10) * 3600 +
                        parseInt(timeMatch[6], 10) * 60 +
                        parseInt(timeMatch[7], 10) +
                        parseInt(timeMatch[8], 10) / 1000;

                    let text = '';
                    i++;
                    while (i < lines.length && lines[i].trim() !== '') {
                        text += (text ? '\n' : '') + lines[i].trim();
                        i++;
                    }

                    text = SubtitleHtmlParser.normalizeSubtitleText(text);
                    const soundEffect = SubtitleParser.extractSoundEffect(text);
                    cues.push({ index: index++, startTime, endTime, text, soundEffect });
                }
            }
            i++;
        }

        return cues;
    }

    // Parse ASS/SSA format (basic)
    static parseASS(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const lines = content.split('\n');
        let inEvents = false;
        let index = 0;

        for (const line of lines) {
            if (line.trim() === '[Events]') {
                inEvents = true;
                continue;
            }

            if (inEvents && line.startsWith('Dialogue:')) {
                const parts = line.substring(9).split(',');
                if (parts.length < 10) { continue; }

                const startParts = parts[1].trim().split(':');
                const endParts = parts[2].trim().split(':');

                const startTime =
                    parseInt(startParts[0], 10) * 3600 +
                    parseInt(startParts[1], 10) * 60 +
                    parseFloat(startParts[2]);

                const endTime =
                    parseInt(endParts[0], 10) * 3600 +
                    parseInt(endParts[1], 10) * 60 +
                    parseFloat(endParts[2]);

                const text = SubtitleHtmlParser.normalizeSubtitleText(
                    SubtitleParser.convertAssOverrides(parts.slice(9).join(','))
                );
                const soundEffect = SubtitleParser.extractSoundEffect(text);

                cues.push({ index: index++, startTime, endTime, text, soundEffect });
            }
        }

        return cues;
    }

    // Auto-detect format and parse
    static parse(content: string, format?: string): SubtitleCue[] {
        if (!content) { return []; }
        // Windows line endings (most .ass files) would leave a trailing break on every cue
        content = content.replace(/\r\n?/g, '\n');

        // Auto-detect format if not specified
        if (!format) {
            if (content.includes('WEBVTT')) { format = 'vtt'; }
            else if (content.includes('[Script Info]')) { format = 'ass'; }
            else { format = 'srt'; }
        }

        switch (format.toLowerCase()) {
            case 'vtt':
            case 'webvtt':
                return SubtitleParser.parseVTT(content);
            case 'ass':
            case 'ssa':
                return SubtitleParser.parseASS(content);
            case 'srt':
            default:
                return SubtitleParser.parseSRT(content);
        }
    }

    /**
     * Every cue showing at currentTime, merged into one (a sign and a line of dialogue are
     * both on screen at once). A linear scan on purpose: cues overlap, and ASS files list
     * events out of time order, which a binary search silently gets wrong. A few thousand
     * comparisons four times a second costs nothing.
     */
    static findActiveCue(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
        let first: SubtitleCue | null = null;
        let text = '';
        for (const cue of cues) {
            if (currentTime >= cue.startTime && currentTime <= cue.endTime) {
                if (!first) {
                    first = cue;
                    text = cue.text;
                } else if (cue.text !== text) {
                    text += '\n' + cue.text;
                }
            }
        }
        if (!first || text === first.text) { return first; }
        return { ...first, text };
    }

    /**
     * Extracts text inside [brackets] or (parentheses)
     * e.g., "[Explosion]" -> "Explosion"
     */
    private static extractSoundEffect(text: string): string | undefined {
        const plainText = SubtitleHtmlParser.stripTags(text);

        // Match [Sound]
        const bracketMatch = plainText.match(/\[(.*?)\]/);
        if (bracketMatch) { return bracketMatch[1]; }

        // Match (Sound) - typically used for speaker names but sometimes sounds
        // We prioritize brackets as they are standard for SDH sound effects
        const parenMatch = plainText.match(/\((.*?)\)/);
        if (parenMatch) { return parenMatch[1]; }

        return undefined;
    }

    private static convertAssOverrides(text: string): string {
        let result = '';
        let bold = false;
        let italic = false;
        let underline = false;

        const closeUntil = (target: { bold?: boolean; italic?: boolean; underline?: boolean }) => {
            if (target.bold === false && bold) {
                result += '</b>';
                bold = false;
            }
            if (target.italic === false && italic) {
                result += '</i>';
                italic = false;
            }
            if (target.underline === false && underline) {
                result += '</u>';
                underline = false;
            }
        };

        const openTag = (tag: 'b' | 'i' | 'u') => {
            result += `<${tag}>`;
        };

        const closeTag = (tag: 'b' | 'i' | 'u') => {
            result += `</${tag}>`;
        };

        const overrideRegex = /\{\\[^}]*\}/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = overrideRegex.exec(text)) !== null) {
            result += text.substring(lastIndex, match.index);
            const block = match[0];
            const commands = block.match(/\\[ibu][01]/gi) || [];

            commands.forEach(command => {
                const type = command[1].toLowerCase();
                const enabled = command[2] === '1';

                if (type === 'b' && enabled !== bold) {
                    enabled ? openTag('b') : closeTag('b');
                    bold = enabled;
                } else if (type === 'i' && enabled !== italic) {
                    enabled ? openTag('i') : closeTag('i');
                    italic = enabled;
                } else if (type === 'u' && enabled !== underline) {
                    enabled ? openTag('u') : closeTag('u');
                    underline = enabled;
                }
            });

            lastIndex = overrideRegex.lastIndex;
        }

        result += text.substring(lastIndex);
        closeUntil({ bold: false, italic: false, underline: false });

        return result;
    }
}
