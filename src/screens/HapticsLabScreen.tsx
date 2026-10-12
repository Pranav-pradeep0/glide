import React, { useState } from 'react';
import { NativeModules, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, ListGroup, ListRow, SectionLabel } from '@/components/ui';
import { useTheme } from '../hooks/useTheme';
import { hasNativeApi } from '../native/GlideNative';
import { metrics, type } from '@/theme/theme';
import type { RootStackParamList } from '../types';
import { useVideoHistoryStore } from '../store/videoHistoryStore';

interface HapticsLab {
    runSeams(amplitude: number): Promise<string>;
    runCalibration(): Promise<string>;
    runDecode(path: string): Promise<Record<string, unknown>>;
    runPlayer(path: string, startMs: number, seconds: number): Promise<string>;
    importTruth(mediaPath: string, truthPath: string): Promise<string>;
}

const lab: HapticsLab | undefined = hasNativeApi(10) ? NativeModules.HapticsLab : undefined;
const performerTest = hasNativeApi(11);

/**
 * Haptics Lab: the Phase 0 measurements of docs/haptics-engine-plan.md. Each test records on
 * the phone and saves a CSV; scripts/haptics-lab.js pulls and scores it. Reached by tapping
 * Settings > Version seven times.
 */
export default function HapticsLabScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const [path, setPath] = useState('/sdcard/Download/1DMP/Videos/Blast.2026.1080p.NF.WEB-DL.DUAL.DDP5.1.H.265-ExtraFlix.P.mkv');
    const [startS, setStartS] = useState('600');
    const [busy, setBusy] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const run = (name: string, task: () => Promise<unknown>) => async () => {
        if (busy || !lab) return;
        setBusy(name);
        const t = Date.now();
        try {
            const result = await task();
            setLog(l => [`${name} (${((Date.now() - t) / 1000).toFixed(1)} s): ${JSON.stringify(result)}`, ...l]);
        } catch (e) {
            setLog(l => [`${name} failed: ${(e as Error).message}`, ...l]);
        } finally {
            setBusy(null);
        }
    };
    const startMs = (Number(startS) || 0) * 1000;

    const tests: [string, string, () => Promise<unknown>][] = lab ? [
        ['L1 Seams', 'Back-to-back calls of 500/250/100 ms vs one call, ~30 s', () => lab.runSeams(128)],
        ['L2 Decode', 'Whole audio of the film below, background lane', () => lab.runDecode(path)],
        ['L4 Tap timing', 'Film through a pass-through tap, 20 s', () => lab.runPlayer(path, startMs, 20)],
        ['L5 Calibration', 'Measures and saves this phone\'s calibration, ~35 s; phone flat on a table', () => lab.runCalibration()],
        ...(performerTest ? [['Performer test', 'Path below is a fixture clip: plays it with its truth track', async () => {
            const result = await lab.importTruth(path, path.replace(/\.\w+$/, '.truth.tsv'));
            useVideoHistoryStore.getState().clearVideoHistory(path); // start at 0, not where the last run stopped
            navigation.navigate('VideoPlayer', { videoPath: path, videoName: path.split('/').pop() ?? path, playMode: 'with-haptics' });
            return result;
        }] as [string, string, () => Promise<unknown>]] : []),
    ] : [];

    return (
        <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <IconButton icon="chevron-left" onPress={() => navigation.goBack()} accessibilityLabel="Back" iconSize={24} />
                <Text style={[type.heading, { color: colors.text }]}>Haptics Lab</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + metrics.space.xl }}>
                {!lab && (
                    <Text style={[type.body, styles.pad, { color: colors.textSecondary }]}>
                        This app version has no Haptics Lab. Install a newer APK.
                    </Text>
                )}
                <SectionLabel title="Film" />
                <View style={styles.pad}>
                    <TextInput
                        value={path}
                        onChangeText={setPath}
                        style={[type.caption, styles.input, { color: colors.text, backgroundColor: colors.fill }]}
                        multiline
                        accessibilityLabel="Film path"
                    />
                    <TextInput
                        value={startS}
                        onChangeText={setStartS}
                        keyboardType="numeric"
                        style={[type.caption, styles.input, { color: colors.text, backgroundColor: colors.fill }]}
                        accessibilityLabel="Start at, seconds"
                    />
                </View>
                <SectionLabel title="Tests" />
                <ListGroup>
                    {tests.map(([title, caption, task]) => (
                        <ListRow
                            key={title}
                            title={busy === title ? `${title} (running)` : title}
                            caption={caption}
                            disabled={!!busy}
                            onPress={run(title, task)}
                        />
                    ))}
                </ListGroup>
                <SectionLabel title="Results" />
                {log.map((line, i) => (
                    <Text key={i} style={[type.caption, styles.pad, { color: colors.textSecondary }]}>
                        {line}
                    </Text>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.sm, padding: metrics.space.sm },
    pad: { paddingHorizontal: metrics.space.lg, paddingVertical: metrics.space.xs },
    input: { borderRadius: metrics.radius.md, padding: metrics.space.sm, marginBottom: metrics.space.sm },
});
