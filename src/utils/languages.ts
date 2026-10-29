/**
 * Language utilities for audio track selection.
 * Includes ISO codes, native names, and smart matching logic.
 */

import { NativeAudioTrack } from '../hooks/video-player/types';

interface LanguageOption {
    code: string;       // ISO code (e.g., 'en', 'jpa')
    name: string;       // English name (e.g., 'English')
    nativeName: string; // Native name (e.g., '日本語')
    aliases: string[];  // Common variations found in track names (lowercase)
}

// Common languages for audio tracks
export const LANGUAGES: LanguageOption[] = [
    { code: 'en', name: 'English', nativeName: 'English', aliases: ['en', 'eng', 'english', 'inglês', 'ingles'] },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', aliases: ['ja', 'jpn', 'japanese', 'jp'] },
    { code: 'es', name: 'Spanish', nativeName: 'Español', aliases: ['es', 'spa', 'spanish', 'esp'] },
    { code: 'fr', name: 'French', nativeName: 'Français', aliases: ['fr', 'fra', 'fre', 'french', 'francais'] },
    { code: 'de', name: 'German', nativeName: 'Deutsch', aliases: ['de', 'deu', 'ger', 'german'] },
    { code: 'it', name: 'Italian', nativeName: 'Italiano', aliases: ['it', 'ita', 'italian'] },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português', aliases: ['pt', 'por', 'portuguese', 'portugues'] },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', aliases: ['ru', 'rus', 'russian'] },
    { code: 'zh', name: 'Chinese', nativeName: '中文', aliases: ['zh', 'zho', 'chi', 'chinese'] },
    { code: 'ko', name: 'Korean', nativeName: '한국어', aliases: ['ko', 'kor', 'korean'] },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', aliases: ['hi', 'hin', 'hindi'] },
    { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', aliases: ['ml', 'mal', 'malayalam'] },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', aliases: ['ar', 'ara', 'arabic'] },
    { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', aliases: ['ta', 'tam', 'tamil'] },
    { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', aliases: ['te', 'tel', 'telugu'] },
    { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', aliases: ['kn', 'kan', 'kannada'] },
    { code: 'th', name: 'Thai', nativeName: 'ไทย', aliases: ['th', 'tha', 'thai'] },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', aliases: ['vi', 'vie', 'vietnamese'] },
    { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', aliases: ['id', 'ind', 'indonesian'] },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', aliases: ['tr', 'tur', 'turkish'] },
];

/**
 * Finds the best matching audio track for a preferred language.
 * Uses smart matching against aliases (e.g., matching "eng" track to "English" preference).
 *
 * @param tracks List of available audio tracks
 * @param preferredLanguageName The English name of the preferred language (e.g., "Japanese")
 * @returns The matching track ID or undefined
 */
export function findMatchingAudioTrack(tracks: NativeAudioTrack[], preferredLanguageName: string | null): number | undefined {
    if (!preferredLanguageName || !tracks || tracks.length === 0) {return undefined;}

    const normalizedPref = preferredLanguageName.trim().toLowerCase();

    // Find the language definition for the user's preference
    const langDef = LANGUAGES.find(l => l.name.toLowerCase() === normalizedPref);

    // If we have a definition, we can match against all its aliases
    // If not (custom input?), we just fallback to simple includes check
    const searchTerms = langDef ? langDef.aliases : [normalizedPref];

    if (__DEV__) {
        if (__DEV__) {console.log('[LanguageUtils] Searching for track matching:', {
            preference: preferredLanguageName,
            searchTerms,
        });}
    }

    // Iterate through tracks and try to match
    // Priority:
    // 1. Exact match of an alias in the name (e.g. name "English" or "eng")
    // 2. Name contains alias with word boundaries (e.g. "[eng]" or " eng ")
    // 3. Name contains alias substring (e.g. "english_track")

    for (const term of searchTerms) {
        // Try to find a track that contains this search term
        const match = tracks.find(t => {
            const trackName = (t.name || '').toLowerCase();

            // Check 1: Exact alias match (unlikely for full track names but possible)
            if (trackName === term) {return true;}

            // Check 2: Word boundary match (very robust)
            // Regex: anything + non-word + term + non-word + anything OR start/end
            // Simple approach: check for [term], (term), -term-, " term "
            if (
                trackName.includes(`[${term}]`) ||
                trackName.includes(`(${term})`) ||
                trackName.includes(` ${term} `) ||
                trackName.includes(`_${term}_`) ||
                trackName.startsWith(`${term} `) ||
                trackName.endsWith(` ${term}`)
            ) {
                return true;
            }

            // Check 3: Simple substring (fallback, might have false positives like 'bengali' matching 'eng')
            // Only use this if the term is at least 3 chars to avoid noise
            if (term.length >= 3 && trackName.includes(term)) {
                return true;
            }

            return false;
        });

        if (match) {
            if (__DEV__) {console.log('[LanguageUtils] Match found:', match.name, 'for term:', term);}
            return match.id;
        }
    }

    return undefined;
}
