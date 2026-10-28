// src/screens/NetworkScreen.tsx
//
// Network shares (docs/network-shares.md): servers found on the network, sign in, pick a share,
// browse its folders with the library's rows, cards and thumbnails, play a file, and the speed test.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TextInputProps, type TextInputInstance, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { RootStackParamList, VideoFile } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { Button, Card, IconButton, ListGroup, ListRow, SectionLabel, Sheet, showDialog } from '@/components/ui';
import { EmptyState, ListHeader, VideoCard, VideoItemCell, VideoItemComponent, VideoRow, listContentStyle } from '@/components/VideoRow';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { Loader } from '@/components/Loader';
import { PHONE_SIGN_IN, SMB_AVAILABLE, SmbEntry, SmbHost, SmbLogin, SmbServer, SmbService } from '@/services/SmbService';
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
    const [found, setFound] = useState<SmbHost[] | null>(null);
    // The sheet's server, `host: ''` for "Add by IP". Kept while it closes so it doesn't blank mid-slide.
    const [target, setTarget] = useState<SmbHost>({ host: '', name: null });
    const [signingIn, setSigningIn] = useState(false);
    // A fresh sheet each time it opens, so it never reopens on the last visit's share list.
    const [opened, setOpened] = useState(0);
    const [help, setHelp] = useState(false);

    useFocusEffect(useCallback(() => { setServers(SmbService.servers()); }, []));

    const search = useCallback(() => {
        if (!SMB_AVAILABLE) { return; }
        setFound(null);
        SmbService.discover().then(setFound, () => setFound([]));
    }, []);
    useEffect(search, [search]);

    const open = (s: SmbServer) => navigation.navigate('NetworkFolder', { uri: SmbService.uri(s), title: s.share });
    const signIn = (h: SmbHost) => { setTarget(h); setOpened(n => n + 1); setSigningIn(true); };

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            {/* Phones open this from Videos; on TV it is a rail page. */}
            <ListHeader title="Network" onBack={IS_TV ? undefined : navigation.goBack}>
                {SMB_AVAILABLE && <>
                    <IconButton icon="info" onPress={() => setHelp(true)} accessibilityLabel="How network shares work" />
                    <IconButton icon="refresh-cw" onPress={() => found && search()} accessibilityLabel="Search again" />
                </>}
            </ListHeader>
            {!SMB_AVAILABLE ? (
                <EmptyState icon="server" text="Update Glide to play from network shares." />
            ) : (
                <ScrollView contentContainerStyle={[styles.content, IS_TV && styles.contentTv]}>
                    {/* First visit: what this is, before any list. Later it's behind the info button. */}
                    {servers.length === 0 && <Card style={styles.intro}><HowItWorks /></Card>}
                    {servers.length > 0 && <>
                        <SectionLabel title="Saved" />
                        <ListGroup>
                            {servers.map((s, i) => (
                                <ListRow
                                    key={`${s.host}/${s.share}`}
                                    preferFocus={i === 0}
                                    icon="server"
                                    title={`\\\\${s.host}\\${s.share}`}
                                    caption={s.user ? s.user : 'Guest'}
                                    chevron
                                    onPress={() => open(s)}
                                />
                            ))}
                        </ListGroup>
                    </>}
                    <SectionLabel title="On this network" />
                    <ListGroup>
                        {found === null && <ListRow title="Searching…" trailing={<ActivityIndicator size="small" color={colors.primary} />} />}
                        {found?.length === 0 && (
                            <ListRow icon="wifi-off" title="No servers found" caption="A Windows PC on a Public network stays hidden: add it by IP." />
                        )}
                        {found?.map(h => (
                            <ListRow
                                key={h.host}
                                icon="monitor"
                                title={h.name ?? h.host}
                                caption={h.name ? h.host : undefined}
                                value={servers.some(s => s.host === h.host) ? 'Saved' : undefined}
                                chevron
                                onPress={() => signIn(h)}
                            />
                        ))}
                        <ListRow
                            icon="plus"
                            title="Add by IP"
                            preferFocus={servers.length === 0}
                            onPress={() => signIn({ host: '', name: null })}
                        />
                    </ListGroup>
                </ScrollView>
            )}
            <Sheet visible={help} onClose={() => setHelp(false)} title="Network shares">
                <ScrollView contentContainerStyle={styles.form}><HowItWorks /></ScrollView>
            </Sheet>
            <SignInSheet
                key={opened}
                target={target}
                visible={signingIn}
                onClose={() => setSigningIn(false)}
                onAdded={s => { setSigningIn(false); setServers(SmbService.servers()); open(s); }}
            />
        </View>
    );
}

/** What network shares are for and how to set one up, in the user's words. */
function HowItWorks() {
    const { colors } = useTheme();
    const steps = [
        'On your computer, share the folder with your videos (on Windows: right-click it → Properties → Sharing).',
        'Here, pick your computer from the list, or add it by its IP address.',
        'Sign in with your Windows username and password, then choose the folder.',
    ];
    return (
        <View style={styles.help}>
            <Text style={[type.row, { color: colors.text }]}>Watch the videos on your computer</Text>
            <Text style={[type.body, { color: colors.textSecondary }]}>
                Play films kept on your PC or NAS straight from here, over your Wi-Fi. Nothing is copied, so they
                take no space on this {IS_TV ? 'TV' : 'phone'}, and your whole collection stays in one place for every device.
            </Text>
            {steps.map((step, i) => (
                <View key={i} style={styles.step}>
                    <Text style={[type.row, styles.stepNumber, { color: colors.primary }]}>{i + 1}</Text>
                    <Text style={[type.body, styles.stepText, { color: colors.text }]}>{step}</Text>
                </View>
            ))}
            <Text style={[type.caption, { color: colors.textSecondary }]}>
                Your computer needs to be on and on the same Wi-Fi. Your password is kept encrypted on this device.
            </Text>
        </View>
    );
}

/**
 * Sign in to a server, then pick one of its shares. `target.host` empty: the IP is typed too.
 * A server that won't list its shares gets a field for the share's name instead.
 */
function SignInSheet({ target, visible, onClose, onAdded }: {
    target: SmbHost; visible: boolean; onClose: () => void; onAdded: (s: SmbServer) => void;
}) {
    const { colors } = useTheme();
    const saved = SmbService.servers().find(s => s.host === target.host);
    const [host, setHost] = useState(target.host);
    const [user, setUser] = useState(saved?.user ?? '');
    const [password, setPassword] = useState('');
    const [domain, setDomain] = useState(saved?.domain ?? '');
    const [shares, setShares] = useState<string[] | null>(null);
    const [share, setShare] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [phone, setPhone] = useState<{ url: string; qr: string } | null>(null);
    // The keyboard's next key moves down the form; on a TV remote that saves leaving the keyboard.
    // Its go key keeps focus too, so the keyboard stays up for the share field.
    const fields = [useRef<TextInputInstance>(null), useRef<TextInputInstance>(null), useRef<TextInputInstance>(null)];
    const next = (i: number) => ({ returnKeyType: 'next' as const, submitBehavior: 'submit' as const, onSubmitEditing: () => fields[i].current?.focus() });
    const login = { host: host.trim(), user: user.trim(), password, domain: domain.trim() };

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    // Never disabled: a disabled button can't take focus on a TV, so the D-pad would just stop.
    const signIn = (l: SmbLogin = login) => (l.host
        ? run(async () => setShares(await SmbService.listShares(l)))
        : setError('Enter the IP address.'));

    // TV: while the sheet is open, a phone can type the login instead of the remote. What it
    // sends fills the fields and signs in, so a wrong password shows here like a typed one.
    useEffect(() => {
        if (!visible || !PHONE_SIGN_IN) { return; }
        const { page, stop } = SmbService.servePhoneSignIn(target.host, sent => {
            const l = { ...sent, host: (target.host || sent.host).trim(), user: sent.user.trim(), domain: sent.domain.trim() };
            setHost(l.host);
            setUser(l.user);
            setPassword(l.password);
            setDomain(l.domain);
            setShares(null);
            signIn(l);
        });
        page.then(setPhone, () => setPhone(null));
        return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one server per opening; `target` is fixed per sheet (keyed by opening)
    }, [visible]);

    const save = (name: string) => (name.trim()
        ? run(async () => {
            const server = await SmbService.add({ ...login, share: name.trim().replace(/^[\\/]+|[\\/]+$/g, '') });
            setPassword('');
            onAdded(server);
        })
        : setError("Enter the share's name."));

    const errorLine = !!error && <Text style={[type.body, { color: colors.error }]}>{error}</Text>;
    const name = target.name ?? target.host;
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={shares ? 'Pick a share' : name ? `Sign in to ${name}` : 'Add by IP'}
            onBack={shares ? () => { setShares(null); setError(''); } : undefined}
            maxHeight={0.9}
        >
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
                {!shares ? <>
                    {phone && (
                        <View style={styles.phone}>
                            <Image source={{ uri: phone.qr }} style={styles.qr} accessibilityLabel="QR code" />
                            <View style={styles.phoneText}>
                                <Text style={[type.row, { color: colors.text }]}>Sign in from your phone</Text>
                                <Text style={[type.body, { color: colors.textSecondary }]}>
                                    Scan the code with your phone's camera, or open {phone.url}
                                </Text>
                                <Text style={[type.caption, { color: colors.textSecondary }]}>
                                    The login travels over your home Wi-Fi unencrypted, like your router's settings page.
                                </Text>
                            </View>
                        </View>
                    )}
                    {!target.host && (
                        <Field label="IP address" value={host} onChangeText={setHost} placeholder="192.168.1.5" keyboardType="numbers-and-punctuation" autoFocus {...next(0)} />
                    )}
                    <Field ref={fields[0]} label="Username" value={user} onChangeText={setUser} placeholder="Empty for guest" autoFocus={!!target.host} {...next(1)} />
                    <Field ref={fields[1]} label="Password" value={password} onChangeText={setPassword} secureTextEntry {...next(2)} />
                    <Field ref={fields[2]} label="Domain (optional)" value={domain} onChangeText={setDomain} returnKeyType="go" submitBehavior="submit" onSubmitEditing={() => signIn()} />
                    <Text style={[type.caption, { color: colors.textSecondary }]}>
                        Windows 11 needs your Windows username and password.
                    </Text>
                    {errorLine}
                    <Button label="Sign in" variant="primary" block loading={busy} onPress={() => signIn()} />
                </> : shares.length > 0 ? <>
                    <ListGroup inset>
                        {shares.map((s, i) => (
                            <ListRow key={s} icon="folder" title={s} preferFocus={i === 0} chevron onPress={() => !busy && save(s)} />
                        ))}
                    </ListGroup>
                    {errorLine}
                    {busy && <Loader fullScreen={false} />}
                </> : <>
                    <Text style={[type.body, { color: colors.textSecondary }]}>
                        {login.host} didn't list its shares. Type the shared folder's name, as in \\{login.host}\Movies.
                    </Text>
                    <Field label="Share" value={share} onChangeText={setShare} placeholder="Movies" autoFocus returnKeyType="go" submitBehavior="submit" onSubmitEditing={() => save(share)} />
                    {errorLine}
                    <Button label="Connect" variant="primary" block loading={busy} onPress={() => save(share)} />
                </>}
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
                // Logins are kept sealed by Glide; no "save password?" from Google's autofill.
                importantForAutofill="no"
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
    const [folders, setFolders] = useState<SmbEntry[]>([]);
    const [films, setFilms] = useState<VideoFile[] | null>(null);
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);
    // Cards on a TV, as in the library.
    const [grid, setGrid] = useState(IS_TV);
    const [selected, setSelected] = useState<VideoFile | null>(null);

    const load = useCallback(() => {
        setError('');
        setFilms(null);
        SmbService.list(uri)
            .then(list => {
                const sorted = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                setFolders(sorted.filter(e => e.isDirectory));
                setFilms(sorted.filter(e => !e.isDirectory && isVideo(e.name)).map(e => ({
                    name: e.name, path: `${uri}/${encodeURIComponent(e.name)}`, size: e.size, modifiedDate: 0, duration: 0, isDirectory: false,
                })));
            })
            .catch(e => setError(errorText(e)));
    }, [uri]);

    useEffect(load, [load]);

    // `smb://host/share` with nothing after it: the share itself, which can be removed here.
    const root = SmbService.servers().find(s => SmbService.uri(s) === uri);

    const play = useCallback((film: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, film.path, { videoName: film.name });
    }, [navigation]);

    const speedTest = () => {
        const largest = films?.slice().sort((a, b) => b.size - a.size)[0];
        if (!largest) {
            showDialog('Speed test', 'Open a folder with a video in it first.');
            return;
        }
        setTesting(true);
        SmbService.speedTest(largest.path)
            .then(report => showDialog(`Speed test: ${largest.name}`, report))
            .catch(e => showDialog('Speed test failed', errorText(e)))
            .finally(() => setTesting(false));
    };

    const remove = () => root && showDialog(`Remove \\\\${root.host}\\${root.share}?`, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { SmbService.remove(root); navigation.goBack(); } },
    ]);

    const renderItem = useCallback(({ item, index }: { item: VideoFile; index: number }) => {
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.path}
                    name={item.name}
                    meta={formatFileSize(item.size)}
                    onPress={play}
                    onMore={setSelected}
                    preferFocus={index === 0 && folders.length === 0}
                />
            </VideoItemCell>
        );
    }, [grid, play, folders.length]);

    // Folders as rows above the films, so they don't take grid cells; no peeking inside for a picture.
    const folderRows = folders.length > 0 && (
        <ListGroup style={[styles.folders, grid && styles.foldersGrid]}>
            {folders.map((e, i) => (
                <ListRow
                    key={e.name}
                    preferFocus={i === 0}
                    icon="folder"
                    title={e.name}
                    chevron
                    onPress={() => navigation.push('NetworkFolder', { uri: `${uri}/${encodeURIComponent(e.name)}`, title: e.name })}
                />
            ))}
        </ListGroup>
    );

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title={title} subtitle={testing ? 'Testing speed, about 1½ minutes…' : undefined} onBack={navigation.goBack}>
                <IconButton icon="activity" onPress={speedTest} disabled={testing || !films} accessibilityLabel="Speed test" />
                {root && <IconButton icon="trash-2" onPress={remove} accessibilityLabel="Remove share" />}
                <IconButton
                    icon={grid ? 'list' : 'grid'}
                    onPress={() => setGrid(!grid)}
                    accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                />
            </ListHeader>
            {error ? (
                <EmptyState icon="wifi-off" text={error} action="Retry" onAction={load} />
            ) : !films ? (
                <Loader />
            ) : films.length === 0 && folders.length === 0 ? (
                <EmptyState icon="folder" text="No folders or videos here." />
            ) : (
                <FlashList
                    data={films}
                    renderItem={renderItem}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? metrics.grid.columns : 1}
                    key={String(grid)}
                    ListHeaderComponent={folderRows || null}
                    contentContainerStyle={listContentStyle(grid, insets.bottom)}
                    showsVerticalScrollIndicator={false}
                />
            )}
            <VideoOptionsBottomSheet
                visible={!!selected}
                video={selected}
                onClose={() => setSelected(null)}
                onPlay={() => selected && play(selected)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.xxl },
    contentTv: { paddingHorizontal: 48, paddingTop: metrics.space.md },
    form: { gap: metrics.space.md, paddingBottom: metrics.space.xl },
    intro: { marginTop: metrics.space.md },
    // Lined up with the row or card edges below them (listContentStyle pads the two differently).
    folders: { marginHorizontal: metrics.space.sm, marginBottom: metrics.space.md },
    foldersGrid: { marginHorizontal: metrics.grid.halfGap },
    help: { gap: metrics.space.md },
    step: { flexDirection: 'row', gap: metrics.space.md },
    stepNumber: { width: 16 },
    stepText: { flex: 1 },
    phone: { flexDirection: 'row', gap: metrics.space.lg, alignItems: 'center' },
    // White around the code is the quiet zone a camera needs to find it.
    qr: { width: 176, height: 176, borderRadius: metrics.radius.md },
    phoneText: { flex: 1, gap: metrics.space.sm },
    label: { marginBottom: metrics.space.xs },
    input: { borderRadius: metrics.radius.md, borderWidth: 2, paddingHorizontal: metrics.space.md, paddingVertical: metrics.space.sm },
});
