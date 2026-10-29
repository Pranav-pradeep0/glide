import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

interface PrivacyIconProps {
    color: string;
}

const W = 200;
const H = 220;
const FRAME_W = 340;
const FRAME_H = 200;
const SCALE = Math.min(FRAME_W / W, FRAME_H / H);
const OFFSET_X = (FRAME_W - W * SCALE) / 2;
const OFFSET_Y = (FRAME_H - H * SCALE) / 2;

export default function PrivacyIcon({ color }: PrivacyIconProps) {
    return (
        <View style={styles.container}>
            <Svg width={FRAME_W} height={FRAME_H} viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}>
                <G transform={`translate(${OFFSET_X} ${OFFSET_Y}) scale(${SCALE})`}>

                {/* ── Shield ── */}
                <Path
                    d="M100 10 L180 45 L180 110 C180 155 100 200 100 200 C100 200 20 155 20 110 L20 45 Z"
                    fill="none"
                    stroke={color}
                    strokeWidth={5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />

                {/* ── Cloud + X (scaled & centred inside shield) ── */}
                {/* Original viewBox 0 0 24 24, scaled ~4x and translated to centre */}
                <G transform="translate(52, 48) scale(4)">
                    <Path
                        d="M13 18.004h-6.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.37 0 2.556 .8 3.117 1.964"
                        fill="none"
                        stroke={color}
                        strokeWidth={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <Path
                        d="M22 22l-5 -5"
                        fill="none"
                        stroke={color}
                        strokeWidth={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <Path
                        d="M17 22l5 -5"
                        fill="none"
                        stroke={color}
                        strokeWidth={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </G>
                </G>

            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        width: FRAME_W,
        height: FRAME_H,
    },
});
