// utils/SubtitleHtmlParser.tsx
import React, { useMemo } from 'react';
import { Platform, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';

/**
 * Represents a parsed text segment with styling information.
 */
interface ParsedSegment {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color?: string;
}

// React Native 0.87 made style properties readonly. Both builders below assemble a
// style by mutation, so they need a writable view of the same shape.
type WritableTextStyle = {-readonly [K in keyof TextStyle]: TextStyle[K]};

interface FlattenedBaseTextStyle extends TextStyle {
    fontFamily?: string;
    fontWeight?: TextStyle['fontWeight'];
    fontStyle?: TextStyle['fontStyle'];
}

interface StyleState {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color?: string;
    skipText: boolean;
}

type TagToken = {
    raw: string;
    name: string;
    closing: boolean;
    selfClosing: boolean;
    attributes: string;
};

const ENTITY_MAP: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    lrm: '\u200E',
    rlm: '\u200F',
    ndash: '-',
    mdash: '-',
    hellip: '...',
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
};

const SUPPORTED_STYLE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'font']);
const STRUCTURAL_TAGS = new Set(['c', 'v', 'lang', 'ruby']);
const SKIP_TEXT_TAGS = new Set(['rt', 'rp']);

/**
 * Subtitle-specific markup parser.
 *
 * This deliberately avoids a full HTML parser. Subtitle cues commonly contain
 * small, sometimes malformed markup fragments from SRT, WebVTT, ASS/SSA, and
 * DVD/stream conversions. A forgiving tokenizer gives more predictable results
 * on-device than trying to render raw HTML-like text.
 */
export class SubtitleHtmlParser {
    static resolveSegmentTextStyle(
        segment: ParsedSegment,
        baseStyle: FlattenedBaseTextStyle
    ): TextStyle {
        const segmentStyle: WritableTextStyle = {};
        const baseFontFamily = baseStyle.fontFamily;
        const baseFontWeight = baseStyle.fontWeight;
        const useCustomFont = !!baseFontFamily && this.canUseCustomFont(segment.text);

        if (baseFontFamily && useCustomFont) {
            segmentStyle.fontFamily = baseFontFamily;
        }

        if (baseFontWeight) {
            segmentStyle.fontWeight = baseFontWeight;
        }

        if (baseStyle.fontStyle) {
            segmentStyle.fontStyle = baseStyle.fontStyle;
        }

        if (baseStyle.lineHeight) {
            segmentStyle.lineHeight = baseStyle.lineHeight;
        }

        if (baseStyle.textShadowColor) {
            segmentStyle.textShadowColor = baseStyle.textShadowColor;
        }

        if (baseStyle.textShadowOffset) {
            segmentStyle.textShadowOffset = baseStyle.textShadowOffset;
        }

        if (baseStyle.textShadowRadius !== undefined) {
            segmentStyle.textShadowRadius = baseStyle.textShadowRadius;
        }

        if (baseStyle.includeFontPadding !== undefined) {
            segmentStyle.includeFontPadding = baseStyle.includeFontPadding;
        }

        // The subtitle font is a registered XML family (res/font) with real bold and
        // italic faces, so plain fontWeight/fontStyle keep the typeface.
        if (segment.bold) {
            segmentStyle.fontWeight = 'bold';
        }

        if (segment.italic) {
            segmentStyle.fontStyle = 'italic';
        }

        if (segment.underline) {
            segmentStyle.textDecorationLine = 'underline';
        }

        // Always set color on nested Text. Android in particular can fail to
        // inherit text color consistently across nested styled Text nodes.
        segmentStyle.color = segment.color || baseStyle.color;

        return segmentStyle;
    }

    static parse(html: string): ParsedSegment[] {
        if (!html || typeof html !== 'string') {
            return [];
        }

        const segments: ParsedSegment[] = [];
        const styleStack: StyleState[] = [];
        let currentStyle: StyleState = {
            bold: false,
            italic: false,
            underline: false,
            color: undefined,
            skipText: false,
        };

        const normalizedText = this.normalizeSubtitleText(html);
        const tagRegex = /<[^>\n]*>/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = tagRegex.exec(normalizedText)) !== null) {
            this.pushTextSegment(
                segments,
                normalizedText.substring(lastIndex, match.index),
                currentStyle
            );

            const tag = this.parseTag(match[0]);
            if (tag) {
                currentStyle = this.applyTag(tag, currentStyle, styleStack);
            } else {
                this.pushTextSegment(segments, match[0], currentStyle);
            }

            lastIndex = tagRegex.lastIndex;
        }

        this.pushTextSegment(
            segments,
            normalizedText.substring(lastIndex),
            currentStyle
        );

        return this.mergeAdjacentSegments(segments);
    }

    static stripTags(html: string): string {
        if (!html || typeof html !== 'string') {
            return '';
        }

        const normalizedText = this.normalizeSubtitleText(html);
        return normalizedText
            .replace(/<\s*(br)\s*\/?\s*>/gi, '\n')
            .replace(/<\s*(rt|rp)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
            .replace(/<\s*\/?\s*(rt|rp)[^>]*>/gi, '')
            .replace(/<[^>\n]*>/g, '')
            .trim();
    }

    static decodeEntities(text: string): string {
        if (!text || text.indexOf('&') === -1) {
            return text;
        }

        return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body) => {
            const normalized = String(body).toLowerCase();

            if (normalized.startsWith('#x')) {
                const codePoint = parseInt(normalized.slice(2), 16);
                return Number.isFinite(codePoint) ? this.fromCodePoint(codePoint, entity) : entity;
            }

            if (normalized.startsWith('#')) {
                const codePoint = parseInt(normalized.slice(1), 10);
                return Number.isFinite(codePoint) ? this.fromCodePoint(codePoint, entity) : entity;
            }

            return ENTITY_MAP[normalized] ?? entity;
        });
    }

    static normalizeSubtitleText(text: string): string {
        return this.decodeEntities(text)
            .replace(/\{\\an\d\}/gi, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/<\s*br\s*\/?\s*>/gi, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }

    static resolveContainerTextStyle(baseStyle: FlattenedBaseTextStyle): TextStyle {
        const containerStyle: WritableTextStyle = { ...baseStyle };
        delete containerStyle.color;
        delete containerStyle.fontFamily;
        delete containerStyle.fontStyle;
        delete containerStyle.fontWeight;
        delete containerStyle.lineHeight;
        delete containerStyle.textShadowColor;
        delete containerStyle.textShadowOffset;
        delete containerStyle.textShadowRadius;
        delete containerStyle.includeFontPadding;
        return containerStyle;
    }

    private static applyTag(
        tag: TagToken,
        currentStyle: StyleState,
        styleStack: StyleState[]
    ): StyleState {
        if (tag.selfClosing || tag.name === 'br') {
            return currentStyle;
        }

        const isKnownOpeningTag =
            SUPPORTED_STYLE_TAGS.has(tag.name) ||
            STRUCTURAL_TAGS.has(tag.name) ||
            SKIP_TEXT_TAGS.has(tag.name);

        if (tag.closing) {
            if (!isKnownOpeningTag) {
                return currentStyle;
            }

            const previousStyle = styleStack.pop();
            return previousStyle ? { ...previousStyle } : currentStyle;
        }

        if (!isKnownOpeningTag) {
            return currentStyle;
        }

        styleStack.push({ ...currentStyle });

        const nextStyle = { ...currentStyle };
        if (tag.name === 'b' || tag.name === 'strong') {
            nextStyle.bold = true;
        } else if (tag.name === 'i' || tag.name === 'em') {
            nextStyle.italic = true;
        } else if (tag.name === 'u') {
            nextStyle.underline = true;
        } else if (tag.name === 'font') {
            const color = this.extractAttribute(tag.raw, 'color');
            if (color) {
                nextStyle.color = this.normalizeColor(color);
            }
        } else if (SKIP_TEXT_TAGS.has(tag.name)) {
            nextStyle.skipText = true;
        }

        return nextStyle;
    }

    private static parseTag(rawTag: string): TagToken | null {
        if (/^<\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*>$/.test(rawTag)) {
            return {
                raw: rawTag,
                closing: false,
                name: 'timestamp',
                attributes: '',
                selfClosing: true,
            };
        }

        const match = rawTag.match(/^<\s*(\/?)\s*([a-z][a-z0-9]*)([^>]*)>$/i);
        if (!match) {
            return null;
        }

        return {
            raw: rawTag,
            closing: match[1] === '/',
            name: match[2].toLowerCase(),
            attributes: match[3] ?? '',
            selfClosing: /\/\s*>$/.test(rawTag),
        };
    }

    private static pushTextSegment(
        segments: ParsedSegment[],
        rawText: string,
        style: StyleState
    ) {
        if (!rawText || style.skipText) {
            return;
        }

        const text = this.decodeEntities(rawText);
        if (!text) {
            return;
        }

        segments.push({
            text,
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
            color: style.color,
        });
    }

    private static mergeAdjacentSegments(segments: ParsedSegment[]): ParsedSegment[] {
        const merged: ParsedSegment[] = [];

        for (const segment of segments) {
            const previous = merged[merged.length - 1];
            if (
                previous &&
                previous.bold === segment.bold &&
                previous.italic === segment.italic &&
                previous.underline === segment.underline &&
                previous.color === segment.color
            ) {
                previous.text += segment.text;
            } else {
                merged.push({ ...segment });
            }
        }

        return merged;
    }

    private static extractAttribute(tag: string, attributeName: string): string | undefined {
        const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRegex = new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
        const match = tag.match(attrRegex);
        return match?.[1] ?? match?.[2] ?? match?.[3];
    }

    private static normalizeColor(color: string): string {
        if (!color) {
            return '';
        }

        const trimmed = this.decodeEntities(color).trim().toLowerCase();

        if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) {
            return trimmed;
        }

        if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) {
            return `#${trimmed}`;
        }

        if (trimmed.startsWith('rgb')) {
            return trimmed;
        }

        return trimmed;
    }

    private static canUseCustomFont(text: string): boolean {
        if (!text) {
            return true;
        }

        // The bundled subtitle font is Latin-focused. Applying it to CJK,
        // Arabic, Indic, Thai, Hebrew, etc. can cause missing glyphs or force
        // the platform into inconsistent fallback. For those scripts, keep the
        // app's color/weight/outline but let the system choose a glyph-complete font.
        if (Platform.OS !== 'android') {
            return true;
        }

        return !/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B00-\u0B7F\u0C00-\u0C7F\u0D00-\u0D7F\u0E00-\u0E7F\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
    }

    private static fromCodePoint(codePoint: number, fallback: string): string {
        try {
            return String.fromCodePoint(codePoint);
        } catch {
            return fallback;
        }
    }
}

interface FormattedSubtitleTextProps {
    text: string;
    baseStyle?: StyleProp<TextStyle>;
    animatedStyle?: any;
    maxLines?: number;
}

export const FormattedSubtitleText: React.FC<FormattedSubtitleTextProps> = ({
    text,
    baseStyle,
    animatedStyle,
    maxLines = 2,
}) => {
    const segments = useMemo(() => SubtitleHtmlParser.parse(text), [text]);

    if (segments.length === 0) {
        return null;
    }

    const baseStyleFlat = (StyleSheet.flatten(baseStyle) || {}) as FlattenedBaseTextStyle;
    const containerTextStyle = SubtitleHtmlParser.resolveContainerTextStyle(baseStyleFlat);

    return (
        <Animated.Text
            style={[
                containerTextStyle,
                animatedStyle,
            ]}
            numberOfLines={maxLines}
        >
            {segments.map((segment, index) => {
                const segmentStyle = SubtitleHtmlParser.resolveSegmentTextStyle(segment, baseStyleFlat);
                return (
                    <Text key={`seg-${index}`} style={segmentStyle}>
                        {segment.text}
                    </Text>
                );
            })}
        </Animated.Text>
    );
};
