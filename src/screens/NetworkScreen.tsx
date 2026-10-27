// src/screens/NetworkScreen.tsx
//
// Network shares, step (a) of docs/network-shares.md: add a share, list its folders, play a
// file, and the speed test. Plain rows for now; (b) brings the library's rows, cards and
// thumbnails.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TextInputProps, type TextInputInstance, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { Button, IconButton, ListGroup, ListRow, Sheet, showDialog } from '@/components/ui';
import { EmptyState, ListHeader } from '@/components/VideoRow';
import { Loader } from '@/components/Loader';
import { SMB_AVAILABLE, SmbEntry, SmbServer, SmbService } from '@/services/SmbService';
import { NavigationService } from '@/services/NavigationService';
import { DeepLinkService } from '@/services/DeepLinkService';
import { formatFileSize } from '@/utils/formatUtils';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const isVideo = (name: string) => DeepLinkService.VIDEO_EXTENSIONS.includes(name.slice(name.lastIndexOf('.')).toLowerCase());
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function NetworkScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const [servers, setServers] = useState<SmbServer[]>([]);
    const [adding, setAdding] = useState(false);

    useFocusEffect(useCallback(() => { setServers(SmbService.servers()); }, []));

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title="Network" />
            {!SMB_AVAILABLE ? (
                <EmptyState icon="server" text="Update Glide to play from network shares." />
            ) : (
                <ScrollView contentContainerStyle={[styles.content, IS_TV && styles.contentTv]}>
                    {servers.length > 0 && (
                        <ListGroup>
                            {servers.map((s, i) => (
                                <ListRow
                                    key={`${s.host}/${s.share}`}
                                    preferFocus={i === 0}
                                    icon="server"
                                    title={`\\\\${s.host}\\${s.share}`}
                                    caption={s.user ? s.user : 'Guest'}
                                    chevron
                                    onPress={() => navigation.navigate('NetworkFolder', { uri: SmbService.uri(s), title: s.share })}
                                />
                            ))}
                        </ListGroup>
                    )}
                    <Button
                        style={styles.add}
                        icon="plus"
                        label="Add network share"
                        variant={servers.length ? 'secondary' : 'primary'}
                        preferFocus={servers.length === 0}
                        onPress={() => setAdding(true)}
                    />
                </ScrollView>
            )}
            <AddShareSheet
                visible={adding}
                onClose={() => setAdding(false)}
                onAdded={() => { setAdding(false); setServers(SmbService.servers()); }}
            />
        </View>
    );
}

function AddShareSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: () => void }) {
    const { colors } = useTheme();
    const [host, setHost] = useState('');
    const [share, setShare] = useState('');
    const [user, setUser] = useState('');
    const [password, setPassword] = useState('');
    const [domain, setDomain] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // The keyboard's next key moves down the form; on a TV remote that saves leaving the keyboard.
    const fields = [useRef<TextInputInstance>(null), useRef<TextInputInstance>(null), useRef<TextInputInstance>(null), useRef<TextInputInstance>(null)];
    const next = (i: number) => ({ returnKeyType: 'next' as const, submitBehavior: 'submit' as const, onSubmitEditing: () => fields[i].current?.focus() });

    // Never disabled: a disabled button can't take focus on a TV, so the D-pad would just stop.
    const connect = async () => {
        if (!host.trim() || !share.trim()) {
            setError('Enter the IP address and the share.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await SmbService.add({
                host: host.trim(),
                share: share.trim().replace(/^[\\/]+|[\\/]+$/g, ''),
                user: user.trim(),
                password,
                domain: domain.trim(),
            });
            setPassword('');
            onAdded();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title="Add network share" maxHeight={0.9}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
                <Field label="IP address" value={host} onChangeText={setHost} placeholder="192.168.1.5" keyboardType="numbers-and-punctuation" autoFocus {...next(0)} />
                <Field ref={fields[0]} label="Share" value={share} onChangeText={setShare} placeholder="Movies" {...next(1)} />
                <Field ref={fields[1]} label="Username" value={user} onChangeText={setUser} placeholder="Empty for guest" {...next(2)} />
                <Field ref={fields[2]} label="Password" value={password} onChangeText={setPassword} secureTextEntry {...next(3)} />
                <Field ref={fields[3]} label="Domain (optional)" value={domain} onChangeText={setDomain} returnKeyType="go" onSubmitEditing={connect} />
                <Text style={[type.caption, { color: colors.textSecondary }]}>
                    The PC's address and the shared folder's name, as in \\192.168.1.5\Movies. Windows 11 needs your
                    Windows username and password.
                </Text>
                {!!error && <Text style={[type.body, { color: colors.error }]}>{error}</Text>}
                <Button label="Connect" variant="primary" block loading={busy} onPress={connect} />
            </ScrollView>
        </Sheet>
    );
}

/** A labelled text field with a focus ring, so the D-pad shows where it is on TV. */
function Field({ label, ref, ...input }: TextInputProps & { label: string; ref?: React.Ref<TextInputInstance> }) {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    return (
        <View>
            <Text style={[type.caption, styles.label, { color: colors.textSecondary }]}>{label}</Text>
            <TextInput
                ref={ref}
                {...input}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={label}
                placeholderTextColor={colors.textTertiary}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[type.row, styles.input, { color: colors.text, backgroundColor: colors.fill, borderColor: focused ? colors.primary : colors.fill }]}
            />
        </View>
    );
}

export function NetworkFolderScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'NetworkFolder'>) {
    const { uri, title } = route.params;
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const [entries, setEntries] = useState<SmbEntry[] | null>(null);
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);

    const load = useCallback(() => {
        setError('');
        setEntries(null);
        SmbService.list(uri)
            .then(list => setEntries(
                list.filter(e => e.isDirectory || isVideo(e.name))
                    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true })),
            ))
            .catch(e => setError(errorText(e)));
    }, [uri]);

    useEffect(load, [load]);

    // `smb://host/share` with nothing after it: the share itself, which can be removed here.
    const root = SmbService.servers().find(s => SmbService.uri(s) === uri);

    const speedTest = () => {
        const largest = entries?.filter(e => !e.isDirectory).sort((a, b) => b.size - a.size)[0];
        if (!largest) {
            showDialog('Speed test', 'Open a folder with a video in it first.');
            return;
        }
        setTesting(true);
        SmbService.speedTest(`${uri}/${encodeURIComponent(largest.name)}`)
            .then(report => showDialog(`Speed test: ${largest.name}`, report))
            .catch(e => showDialog('Speed test failed', errorText(e)))
            .finally(() => setTesting(false));
    };

    const remove = () => root && showDialog(`Remove \\\\${root.host}\\${root.share}?`, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { SmbService.remove(root); navigation.goBack(); } },
    ]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title={title} subtitle={testing ? 'Testing speed, about 1½ minutes…' : undefined} onBack={navigation.goBack}>
                <IconButton icon="activity" onPress={speedTest} disabled={testing || !entries} accessibilityLabel="Speed test" />
                {root && <IconButton icon="trash-2" onPress={remove} accessibilityLabel="Remove share" />}
            </ListHeader>
            {error ? (
                <EmptyState icon="wifi-off" text={error} action="Retry" onAction={load} />
            ) : !entries ? (
                <Loader />
            ) : entries.length === 0 ? (
                <EmptyState icon="folder" text="No folders or videos here." />
            ) : (
                <ScrollView contentContainerStyle={[styles.content, IS_TV && styles.contentTv]}>
                    <ListGroup>
                        {entries.map((e, i) => (
                            <ListRow
                                key={e.name}
                                preferFocus={i === 0}
                                icon={e.isDirectory ? 'folder' : 'film'}
                                title={e.name}
                                caption={e.isDirectory ? undefined : formatFileSize(e.size)}
                                chevron={e.isDirectory}
                                onPress={() => {
                                    const child = `${uri}/${encodeURIComponent(e.name)}`;
                                    if (e.isDirectory) {
                                        navigation.push('NetworkFolder', { uri: child, title: e.name });
                                    } else {
                                        NavigationService.handleVideoNavigation(navigation, child, { videoName: e.name });
                                    }
                                }}
                            />
                        ))}
                    </ListGroup>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.xxl },
    contentTv: { paddingHorizontal: 48, paddingTop: metrics.space.md },
    add: { marginTop: metrics.space.lg, alignSelf: 'flex-start' },
    form: { gap: metrics.space.md, paddingBottom: metrics.space.xl },
    label: { marginBottom: metrics.space.xs },
    input: { borderRadius: metrics.radius.md, borderWidth: 2, paddingHorizontal: metrics.space.md, paddingVertical: metrics.space.sm },
});
