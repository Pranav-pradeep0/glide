// Runs the deployed recap prompt on real subtitle files and checks each result by script.
//   BASE_URL=https://glide-proxy.glidemediaplayer.workers.dev node eval-recap.mjs [file.srt ...]
// With no files, uses every .srt in ../.haptics-fixtures/films. One Groq call per file.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const base = process.env.BASE_URL?.replace(/\/$/, '');
if (!base) {
    console.error('Set BASE_URL to the deployed Worker URL.');
    process.exit(1);
}

const fixtures = new URL('../.haptics-fixtures/films/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const files = process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(fixtures).filter(f => f.endsWith('.srt')).map(f => join(fixtures, f));

const toSeconds = t => {
    const [h, m, s] = t.replace(',', '.').split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
};

function parseSrt(text) {
    return text.replace(/\r/g, '').split(/\n\n+/).flatMap(block => {
        const lines = block.split('\n');
        const i = lines.findIndex(l => l.includes('-->'));
        if (i < 0) {return [];}
        const [start, end] = lines[i].split('-->').map(s => toSeconds(s.trim().split(' ')[0]));
        return [{ startTime: start, endTime: end, text: lines.slice(i + 1).join(' ') }];
    });
}

// ponytail: mirrors RecapService.getRecentDialogueStats by hand; import it if the two drift.
function recentDialogue(cues, resume, windowSeconds = 300) {
    const out = [];
    let lastEnd = Infinity;
    for (const cue of cues.filter(c => c.startTime >= resume - windowSeconds && c.startTime <= resume)) {
        if (cue.startTime - lastEnd > 8 && out.length > 0) {out.push('');}
        lastEnd = cue.endTime;
        const text = cue.text.replace(/<[^>]*>/g, '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
        if (text) {out.push(text);}
    }
    let dialogue = out.join('\n');
    if (dialogue.length > 5000) {
        const cut = dialogue.substring(dialogue.length - 5000);
        dialogue = cut.substring(Math.max(0, cut.indexOf(' '))).trim();
    }
    return dialogue;
}

function problems(recap, dialogue, title) {
    const found = [];
    const words = recap.split(/\s+/).filter(Boolean);
    if (words.length > 70) {found.push(`${words.length} words`);}
    const sentences = recap.replace(/\b(Mr|Mrs|Ms|Dr|St)\./g, '$1').split(/[.!?]+(?:\s|$)/).filter(s => s.trim()).length;
    if (sentences > 3) {found.push(`${sentences} sentences`);}
    if (/^(previously|in this scene|recap)/i.test(recap)) {found.push('preamble');}
    if (/subtitle|dialogue|\bAI\b|the scene|last line|the pause/i.test(recap)) {found.push('mentions the source');}
    if (/["“](\S+\s+){3,}\S+["”]/.test(recap)) {found.push('quotes a line');}
    if (/^[#*-]|\n/.test(recap)) {found.push('formatting');}
    // A capitalised word mid-sentence that the subtitles and title never use is probably invented.
    const known = `${dialogue} ${title}`.toLowerCase();
    const invented = [...recap.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-z]{2,})\b/g)]
        .map(m => m[1])
        .filter(name => !known.includes(name.toLowerCase()));
    if (invented.length) {found.push(`names not in subtitles: ${[...new Set(invented)].join(', ')}`);}
    return found;
}

let failures = 0;
for (const [n, file] of files.entries()) {
    if (n > 0) {await new Promise(r => setTimeout(r, 11000));} // proxy allows 6 recaps a minute per IP
    const cues = parseSrt(readFileSync(file, 'utf8'));
    const resume = cues[cues.length - 1].endTime / 2;
    const title = basename(file, '.srt');
    const dialogue = recentDialogue(cues, resume);
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue, title }),
    });
    const recap = res.ok ? (await res.json()).recap : '';
    const found = res.ok ? problems(recap, dialogue, title) : [`HTTP ${res.status}`];
    if (found.length) {failures++;}
    console.log(`\n${found.length ? 'FAIL' : 'PASS'} ${title} @ ${Math.round(resume / 60)} min${found.length ? ` (${found.join('; ')})` : ''}\n${recap}`);
}

console.log(failures === 0 ? '\nAll recaps passed.' : `\n${failures} of ${files.length} recaps failed.`);
process.exit(failures === 0 ? 0 : 1);
