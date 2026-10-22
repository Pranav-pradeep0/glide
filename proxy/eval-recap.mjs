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

// ponytail: mirrors RecapService.cleanCue / getRecentDialogueStats by hand (that file pulls in
// native modules); __tests__/recapDialogue.test.ts pins the real behaviour. Keep the two in step.
const cleanCue = raw => raw
    .replace(/<[^>]*>/g, '')
    .replace(/[[(]([A-Z][a-z][\w.'-]*(?:\s[A-Z][\w.'-]*){0,2})[\])]\s*(?=[^\s[(])/g, '$1: ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .split(/(?:^|\s)-\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

function recentDialogue(cues, resume) {
    const recent = cues.filter(c => c.startTime >= resume - 1200 && c.startTime <= resume);
    const lines = [];
    let chars = 0;
    let nextStart = Infinity;
    for (let i = recent.length - 1; i >= 0; i--) {
        const turns = cleanCue(recent[i].text);
        if (!turns.length) {continue;}
        const size = turns.join('\n').length + 1;
        if (chars + size > 5000) {break;}
        if (nextStart - recent[i].endTime > 8 && lines.length) {lines.push('');}
        nextStart = recent[i].startTime;
        lines.push(...turns.reverse());
        chars += size;
    }
    return lines.reverse().join('\n');
}

function problems(recap, dialogue, title) {
    const found = [];
    const words = recap.split(/\s+/).filter(Boolean);
    if (words.length > 70) {found.push(`${words.length} words`);}
    const sentences = recap.replace(/\b(Mr|Mrs|Ms|Dr|St)\./g, '$1').split(/[.!?]+(?:\s|$)/).filter(s => s.trim()).length;
    if (sentences > 3) {found.push(`${sentences} sentences`);}
    if (/^(previously|in this scene|recap)/i.test(recap)) {found.push('preamble');}
    if (/subtitle|dialogue|\bAI\b|the scene|last line|the pause/i.test(recap)) {found.push('mentions the source');}
    if (/["“]([^\s"“”]+\s+){3,}[^\s"“”]+["”]/.test(recap)) {found.push('quotes a line');}
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
    const resume = Number(process.env.RESUME_SECONDS) || cues[cues.length - 1].endTime / 2;
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
