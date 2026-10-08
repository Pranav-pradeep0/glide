import { describe, expect, it } from '@jest/globals';
import { ContextAnalyzer } from '../src/services/ContextAnalyzer';

describe('ContextAnalyzer', () => {
    it('handles punctuation cleanly without missing keywords', () => {
        const result = ContextAnalyzer.analyze('[running, fast!]', 'running');
        expect(result.speedMultiplier).toBeGreaterThan(1.0);
        expect(result.modifiers).toContain('fast');
    });

    it('scores sentiment on AFINN scale with inflections', () => {
        const resultTerror = ContextAnalyzer.analyze('[screaming in terror!]', 'screaming');
        // 'screaming' (-2) + 'terror' (-3) = -5 (clamped)
        expect(resultTerror.sentimentScore).toBe(-5);
        expect(resultTerror.intensityMultiplier).toBeGreaterThan(1.0); // tension >= 2 boosts intensity

        const resultCalm = ContextAnalyzer.analyze('[gentle peaceful smile]', 'smile');
        // 'gentle' (+2) + 'peaceful' (+2) + 'smile' (+2) = +5 (clamped)
        expect(resultCalm.sentimentScore).toBe(5);
        expect(resultCalm.modifiers).toContain('gentle');
    });

    it('is immune to prototype properties like constructor or toString', () => {
        const result = ContextAnalyzer.analyze('constructor toString valueOf __proto__', 'constructor');
        expect(result.sentimentScore).toBe(0);
        expect(result.modifiers).toEqual([]);
        expect(result.intensityMultiplier).toBe(1.0);
        expect(result.speedMultiplier).toBe(1.0);
    });

    it('applies modifiers and spatial proximity effects', () => {
        const result = ContextAnalyzer.analyze('[heavy footsteps nearby]', 'footsteps');
        expect(result.modifiers).toContain('heavy');
        expect(result.roughness).toBeGreaterThan(0);
        expect(result.intensityMultiplier).toBeGreaterThan(1.0);
    });
});
