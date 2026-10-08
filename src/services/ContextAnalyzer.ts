export interface HapticContext {
    intensityMultiplier: number; // 0.5 to 2.0 (Default 1.0)
    speedMultiplier: number;     // 0.5 to 2.0 (Default 1.0)
    roughness: number;           // 0.0 to 1.0 (Texture)
    sharpness: number;           // 0.0 to 1.0 (Attack speed)
    sentimentScore: number;      // -5 to +5
    modifiers: string[];         // Detected adjectives
}

export class ContextAnalyzer {
    /**
     * Maps textual modifiers to physical haptic parameters
     */
    private static readonly MODIFIER_MAP = new Map<string, Partial<HapticContext>>([
        ['heavy', { intensityMultiplier: 1.5, speedMultiplier: 0.9, roughness: 0.6 }],
        ['hard', { intensityMultiplier: 1.4, sharpness: 0.8 }],
        ['violent', { intensityMultiplier: 1.8, roughness: 0.9, speedMultiplier: 1.2 }],
        ['soft', { intensityMultiplier: 0.6, sharpness: 0.2 }],
        ['faint', { intensityMultiplier: 0.4, roughness: 0.1 }],
        ['light', { intensityMultiplier: 0.6, sharpness: 0.3 }],
        ['fast', { speedMultiplier: 1.5 }],
        ['rapid', { speedMultiplier: 1.7, sharpness: 0.7 }],
        ['slow', { speedMultiplier: 0.6 }],
        ['steady', { speedMultiplier: 1.0 }],
        ['frantic', { speedMultiplier: 1.8, roughness: 0.5 }],
        ['shaky', { roughness: 0.8 }],
        ['coarse', { roughness: 0.9 }],
        ['smooth', { roughness: 0.0 }],
        ['raspy', { roughness: 0.7 }],
        ['distant', { intensityMultiplier: 0.5, sharpness: 0.1, roughness: 0.2 }],
        ['muffled', { sharpness: 0.1, roughness: 0.3 }],
        ['sharp', { sharpness: 1.0 }],
        ['gentle', { intensityMultiplier: 0.6, sharpness: 0.2 }],
        ['calm', { intensityMultiplier: 0.7, roughness: 0.0 }],
    ]);

    /**
     * Maps verbs to speed dynamics (including common inflected forms)
     */
    private static readonly VERB_MAP = new Map<string, Partial<HapticContext>>([
        ['run', { speedMultiplier: 1.8 }],
        ['running', { speedMultiplier: 1.8 }],
        ['ran', { speedMultiplier: 1.8 }],
        ['walk', { speedMultiplier: 1.0 }],
        ['walking', { speedMultiplier: 1.0 }],
        ['walked', { speedMultiplier: 1.0 }],
        ['crawl', { speedMultiplier: 0.5 }],
        ['crawling', { speedMultiplier: 0.5 }],
        ['crawled', { speedMultiplier: 0.5 }],
        ['sprint', { speedMultiplier: 2.0, intensityMultiplier: 1.2 }],
        ['sprinting', { speedMultiplier: 2.0, intensityMultiplier: 1.2 }],
        ['sprinted', { speedMultiplier: 2.0, intensityMultiplier: 1.2 }],
        ['limp', { speedMultiplier: 0.7, roughness: 0.3 }],
        ['limping', { speedMultiplier: 0.7, roughness: 0.3 }],
        ['limped', { speedMultiplier: 0.7, roughness: 0.3 }],
        ['dash', { speedMultiplier: 1.9 }],
        ['dashing', { speedMultiplier: 1.9 }],
        ['dashed', { speedMultiplier: 1.9 }],
        ['stumble', { speedMultiplier: 0.8, roughness: 0.5 }],
        ['stumbling', { speedMultiplier: 0.8, roughness: 0.5 }],
        ['stumbled', { speedMultiplier: 0.8, roughness: 0.5 }],
    ]);

    /**
     * Maps words to sentiment scores (-3 to +3 matching AFINN scale, including inflections)
     */
    private static readonly SENTIMENT_WORDS = new Map<string, number>([
        // High negative (-3)
        ['terror', -3], ['terrified', -3], ['terrifying', -3],
        ['panic', -3], ['panicked', -3], ['panicking', -3],
        ['horror', -3], ['horrific', -3], ['horrible', -3],
        ['violent', -3], ['violence', -3],
        ['agony', -3], ['agonizing', -3],
        ['nightmare', -3],
        ['kill', -3], ['killing', -3], ['killed', -3],

        // Moderate negative (-2)
        ['scream', -2], ['screaming', -2], ['screams', -2], ['screamed', -2],
        ['cry', -2], ['crying', -2], ['cries', -2], ['cried', -2],
        ['fear', -2], ['fearful', -2], ['fearing', -2],
        ['pain', -2], ['painful', -2],
        ['hurt', -2], ['hurting', -2],
        ['angry', -2], ['anger', -2],
        ['mad', -2],
        ['yell', -2], ['yelling', -2], ['yelled', -2],
        ['danger', -2], ['dangerous', -2],
        ['threat', -2], ['threatening', -2],
        ['shock', -2], ['shocked', -2], ['shocking', -2],
        ['tense', -2], ['tension', -2],
        ['stress', -2], ['stressed', -2],
        ['grief', -2],
        ['harsh', -2],

        // Mild negative (-1)
        ['sad', -1], ['bad', -1], ['cold', -1], ['hard', -1], ['heavy', -1],

        // High positive (+3)
        ['happy', 3], ['happiness', 3],
        ['joy', 3], ['joyful', 3],
        ['love', 3], ['loving', 3],
        ['great', 3],

        // Moderate positive (+2)
        ['smile', 2], ['smiling', 2], ['smiled', 2],
        ['calm', 2], ['calming', 2],
        ['gentle', 2], ['gently', 2],
        ['peace', 2], ['peaceful', 2],
        ['relief', 2], ['relieved', 2],
        ['relax', 2], ['relaxing', 2], ['relaxed', 2],
        ['good', 2], ['sweet', 2], ['warm', 2], ['warmth', 2],
        ['comfort', 2], ['comfortable', 2], ['pleasant', 2],
        ['bright', 2], ['cheer', 2], ['cheerful', 2],

        // Mild positive (+1)
        ['laugh', 1], ['laughing', 1], ['laughter', 1],
        ['soft', 1], ['light', 1],
    ]);

    /**
     * Maps spatial keywords to proximity effects
     */
    private static readonly SPATIAL_MAP = new Map<string, Partial<HapticContext>>([
        ['distance', { intensityMultiplier: 0.4, sharpness: 0.1, roughness: 0.2 }],
        ['far', { intensityMultiplier: 0.3, sharpness: 0.05 }],
        ['away', { intensityMultiplier: 0.6 }],
        ['nearby', { intensityMultiplier: 1.2, sharpness: 0.8 }],
        ['close', { intensityMultiplier: 1.3, sharpness: 0.9 }],
    ]);

    /**
     * Analyzes the context of a sound effect
     * @param text The full subtitle text (e.g., "[Heavy breathing]")
     * @param keyword The detected sound keyword (e.g., "breathing")
     */
    static analyze(text: string, keyword: string): HapticContext {
        // 1. Clean terms & split on any non-alpha/apostrophe to safely discard punctuation
        const lowerText = text.toLowerCase();
        const words = lowerText.split(/[^a-z']+/).filter(Boolean);

        // 2. Analyze Sentiment with scale matching AFINN
        let rawScore = 0;
        for (const word of words) {
            const score = this.SENTIMENT_WORDS.get(word);
            if (score !== undefined) {
                rawScore += score;
            }
        }
        // Clamp to [-5, 5] as per HapticContext definition
        const sentimentScore = Math.max(-5, Math.min(5, rawScore));

        // 3. Extract Features and Calculate Parameters
        const context: HapticContext = {
            intensityMultiplier: 1.0,
            speedMultiplier: 1.0,
            roughness: 0.0,
            sharpness: 0.5,
            sentimentScore: sentimentScore,
            modifiers: [],
        };

        const verbsFound: string[] = [];

        for (const word of words) {
            // Apply Modifiers (Adjectives) via Map (immune to prototype pollution)
            const mappedModifier = this.MODIFIER_MAP.get(word);
            if (mappedModifier) {
                this.applyToContext(context, mappedModifier);
                context.modifiers.push(word);
            }

            // Apply Verbs (Dynamics) via Map
            const mappedVerb = this.VERB_MAP.get(word);
            if (mappedVerb) {
                this.applyToContext(context, mappedVerb);
                verbsFound.push(word);
            }
        }

        // 4. Apply Spatial Clues (Proximity)
        for (const [key, mapped] of this.SPATIAL_MAP.entries()) {
            if (lowerText.includes(key)) {
                this.applyToContext(context, mapped);
            }
        }

        // 5. Apply Sentiment Influence
        const tension = Math.abs(sentimentScore);
        if (tension >= 2) {
            context.intensityMultiplier *= (1 + (tension * 0.05));
        }

        // 6. Debug Log (Verification)
        if (__DEV__) {
            console.log(`[HapticAI] 🧠 Analyzing "${text}"`);
            console.log(`   └─ Sentiment: ${sentimentScore}`);
            console.log(`   └─ Verbs: [${verbsFound.join(', ')}]`);
            console.log(`   └─ Params: Intensity x${context.intensityMultiplier.toFixed(2)}, Speed x${context.speedMultiplier.toFixed(2)}, Texture: ${context.roughness.toFixed(2)}`);
        }

        return context;
    }

    private static applyToContext(context: HapticContext, mapped: Partial<HapticContext>) {
        if (mapped.intensityMultiplier) {context.intensityMultiplier *= mapped.intensityMultiplier;}
        if (mapped.speedMultiplier) {context.speedMultiplier *= mapped.speedMultiplier;}
        if (mapped.roughness !== undefined) {context.roughness = Math.max(context.roughness, mapped.roughness);}
        if (mapped.sharpness !== undefined) {context.sharpness = mapped.sharpness;}
    }
}
