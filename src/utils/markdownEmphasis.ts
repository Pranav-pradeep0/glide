export interface EmphasisSpan {
    text: string;
    bold?: boolean;
    italic?: boolean;
}

/**
 * Markdown emphasis in AI text (the recap): "**bold**", "*italic*" (a title like
 * *Frankenstein*). Anything else, a lone "*" included, stays as written.
 */
export function parseEmphasis(text: string): EmphasisSpan[] {
    const spans: EmphasisSpan[] = [];
    let last = 0;
    for (const m of text.matchAll(/\*\*([^*\n]+)\*\*|\*([^*\s][^*\n]*?)\*/g)) {
        if (m.index > last) { spans.push({ text: text.slice(last, m.index) }); }
        spans.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true });
        last = m.index + m[0].length;
    }
    if (last < text.length) { spans.push({ text: text.slice(last) }); }
    return spans;
}
