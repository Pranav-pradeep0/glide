/**
 * Equalizer Presets Configuration
 *
 * Defines standard frequency bands and preset gain values.
 * Frequencies: 60Hz, 170Hz, 310Hz, 600Hz, 1kHz, 3kHz, 6kHz, 12kHz, 14kHz, 16kHz
 */

export const EQUALIZER_BANDS = [
    { freq: 60, label: '60Hz', note: 'Sub-bass/Rumble' },
    { freq: 170, label: '170Hz', note: 'Bass/Kick' },
    { freq: 310, label: '310Hz', note: 'Low-mids/Warmth' },
    { freq: 600, label: '600Hz', note: 'Mids/Vocals' },
    { freq: 1000, label: '1kHz', note: 'Upper-mids/Attack' },
    { freq: 3000, label: '3kHz', note: 'Presence/Definition' },
    { freq: 6000, label: '6kHz', note: 'Brilliance' },
    { freq: 12000, label: '12kHz', note: 'Air/Openness' },
    { freq: 14000, label: '14kHz', note: 'High Air' },
    { freq: 16000, label: '16kHz', note: 'Ultra-high' },
];

export interface EqualizerPreset {
    id: string;
    name: string;
    values: number[]; // 10 values, -20 to 20 dB
    icon?: string; // Feather icon name
}

export const EQUALIZER_PRESETS: EqualizerPreset[] = [
    {
        id: 'flat',
        name: 'Flat',
        values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        icon: 'minus',
    },
    {
        id: 'bass_boost',
        name: 'Bass Boost',
        values: [6, 4, 2, 0, 0, 0, 0, 0, 0, 0], // Enhanced low end
        icon: 'bar-chart-2',
    },
    {
        id: 'treble_boost',
        name: 'Treble Boost',
        values: [0, 0, 0, 0, 0, 2, 4, 5, 5, 4], // Enhanced highs
        icon: 'activity',
    },
    {
        id: 'vocal',
        name: 'Vocal / Speech',
        values: [-2, -2, 0, 2, 4, 4, 2, 0, 0, 0], // Cut muddy bass, boost speech range
        icon: 'mic',
    },
    {
        id: 'rock',
        name: 'Rock',
        values: [4, 3, 1, 0, -1, 1, 3, 4, 4, 3], // "V" shape - punchy bass and highs
        icon: 'music',
    },
    {
        id: 'classical',
        name: 'Classical',
        values: [4, 3, 2, 2, 1, 1, 2, 3, 3, 3], // Gentle lift across spectrum
        icon: 'music',
    },
    {
        id: 'jazz',
        name: 'Jazz',
        values: [3, 2, 3, 4, 2, 2, 3, 2, 1, 1], // Warm mids and bass
        icon: 'music',
    },
    {
        id: 'electronic',
        name: 'Electronic / EDM',
        values: [6, 5, 1, -2, -2, 1, 3, 5, 5, 0], // Deep bass, crisp highs
        icon: 'zap',
    },
];
