// src/screens/TelegramScreen.tsx
//
// Telegram (docs/telegram.md): sign in (phone number + code on phones, QR on TV, then the 2-step
// password), the chats that have videos (Saved Messages first), and a chat's videos with the
// library's rows, cards and thumbnails.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { RootStackParamList, VideoFile } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { Button, Card, IconButton, ListGroup, ListRow, SectionLabel, showDialog } from '@/components/ui';
import { EmptyState, ListHeader, VideoCard, VideoItemCell, VideoItemComponent, VideoRow, listContentStyle } from '@/components/VideoRow';
import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';
import { Loader } from '@/components/Loader';
import { Field } from '@/screens/NetworkScreen';
import { TELEGRAM_AVAILABLE, TelegramService, TgAuth, TgChat, TgVideo } from '@/services/TelegramService';
import { NavigationService } from '@/services/NavigationService';
import { formatFileSize } from '@/utils/formatUtils';
import { metrics, type } from '@/theme/theme';
import { IS_TV } from '@/utils/tv';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAGE = 30;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Each chat's first page, fetched while finding which chats have videos; opening the chat uses
 * it once, so a later visit fetches fresh.
 */
const firstPages = new Map<number, { items: TgVideo[]; next: number }>();

export default function TelegramScreen() {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();
    const [auth, setAuth] = useState<TgAuth>({ state: 'starting' });
    const [error, setError] = useState('');

    useEffect(() => {
        if (!TELEGRAM_AVAILABLE) { return; }
        let heard = false;
        const { auth: first, stop } = TelegramService.start(a => { heard = true; setAuth(a); });
        // An event can overtake the first answer; it's the newer state then.
        first.then(a => { if (!heard) { setAuth(a); } }, e => setError(errorText(e)));
        return stop;
    }, []);

    const logOut = () => showDialog('Sign out of Telegram?', 'Videos downloaded from Telegram are deleted from this device.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { TelegramService.logOut().catch(e => setError(errorText(e))); } },
    ]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            {/* Phones open this from Videos; on TV it is a rail page. */}
            <ListHeader title="Telegram" onBack={IS_TV ? undefined : navigation.goBack}>
                {auth.state === 'ready' && <IconButton icon="log-out" onPress={logOut} accessibilityLabel="Sign out of Telegram" />}
            </ListHeader>
            {!TELEGRAM_AVAILABLE ? (
                <EmptyState icon="send" text="Update Glide to watch videos from Telegram." />
            ) : error ? (
                <EmptyState icon="wifi-off" text={error} />
            ) : auth.state === 'ready' ? (
                <Chats name={auth.name} />
            ) : auth.state === 'starting' || auth.state === 'loggingOut' ? (
                <Loader />
            ) : (
                <ScrollView contentContainerStyle={[styles.content, IS_TV && styles.contentTv]} keyboardShouldPersistTaps="handled">
                    <SignIn auth={auth} />
                </ScrollView>
            )}
        </View>
    );
}

/** One step of Telegram's sign-in, whichever TDLib is waiting for. */
function SignIn({ auth }: { auth: TgAuth }) {
    const { colors } = useTheme();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // TV starts with the QR code (no typing with a remote); "Use phone number instead" sets this.
    const [wantPhone, setWantPhone] = useState(!IS_TV);

    const run = useCallback(async (work: () => Promise<unknown>) => {
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { setText(''); }, [auth.state]);
    useEffect(() => {
        if (auth.state === 'phone' && !wantPhone) { run(TelegramService.requestQr); }
    }, [auth.state, wantPhone, run]);

    const submit = () => {
        const t = text.trim();
        if (!t) { return; }
        if (auth.state === 'phone') { run(() => TelegramService.phoneNumber(t)); }
        if (auth.state === 'code') { run(() => TelegramService.code(t)); }
        if (auth.state === 'password') { run(() => TelegramService.password(text)); }
    };
    // TDLib can't go back from these steps; signing out starts over at the phone number.
    const startOver = (phone = true) => { setWantPhone(phone); run(TelegramService.logOut); };

    const errorLine = !!error && <Text style={[type.body, { color: colors.error }]}>{error}</Text>;
    const field = (props: React.ComponentProps<typeof Field>) => <>
        <Field value={text} onChangeText={setText} autoFocus returnKeyType="go" submitBehavior="submit" onSubmitEditing={submit} {...props} />
        {errorLine}
        <Button label="Next" variant="primary" block loading={busy} onPress={submit} />
    </>;

    return (
        <View style={styles.form}>
            <Card style={styles.intro}>
                <Text style={[type.row, { color: colors.text }]}>Watch the videos in your Telegram chats</Text>
                <Text style={[type.body, { color: colors.textSecondary }]}>
                    Forward a video to your Saved Messages and it shows up here. Films play while they download, and nothing passes through Glide's servers.
                </Text>
            </Card>
            {auth.state === 'phone' && (wantPhone ? <>
                {field({ label: 'Phone number', keyboardType: 'phone-pad', placeholder: '+91 98765 43210', textContentType: 'telephoneNumber' })}
                <Button label="Use QR code instead" block onPress={() => setWantPhone(false)} />
            </> : busy ? <Loader fullScreen={false} /> : <>
                {errorLine}
                <Button label="Show QR code" variant="primary" block onPress={() => run(TelegramService.requestQr)} />
                <Button label="Use phone number instead" block onPress={() => setWantPhone(true)} />
            </>)}
            {auth.state === 'qr' && <>
                <View style={styles.qrRow}>
                    <Image source={{ uri: auth.qr }} style={styles.qr} accessibilityLabel="Telegram sign-in QR code" />
                    <View style={styles.qrText}>
                        <Text style={[type.row, { color: colors.text }]}>Scan with Telegram on your phone</Text>
                        <Text style={[type.body, { color: colors.textSecondary }]}>
                            In Telegram, open Settings → Devices → Link Desktop Device, then point the camera at this code.
                        </Text>
                    </View>
                </View>
                {errorLine}
                <Button label="Use phone number instead" block loading={busy} onPress={() => startOver(true)} />
            </>}
            {auth.state === 'code' && <>
                <Text style={[type.body, { color: colors.textSecondary }]}>
                    {auth.sentTo === 'telegram'
                        ? `Telegram sent a code to your Telegram app on another device (${auth.phone}).`
                        : `Telegram sent a code to ${auth.phone}.`}
                </Text>
                {field({ label: 'Code', keyboardType: 'number-pad', textContentType: 'oneTimeCode' })}
                <Button label="Use a different number" block onPress={() => startOver(true)} />
            </>}
            {auth.state === 'password' && <>
                <Text style={[type.body, { color: colors.textSecondary }]}>
                    Your account has two-step verification. Enter its password{auth.hint ? ` (hint: ${auth.hint})` : ''}.
                </Text>
                {field({ label: 'Password', secureTextEntry: true })}
                <Button label="Start again" block onPress={() => startOver(!IS_TV)} />
            </>}
            {auth.state === 'unsupported' && <>
                <Text style={[type.body, { color: colors.text }]}>
                    Telegram needs you to finish setting up your account in the Telegram app first. Then come back and sign in.
                </Text>
                {errorLine}
                <Button label="Start again" variant="primary" block loading={busy} onPress={() => startOver(!IS_TV)} />
            </>}
            <Text style={[type.caption, { color: colors.textSecondary }]}>
                You sign in through Telegram itself. The session stays on this {IS_TV ? 'TV' : 'phone'}; signing out deletes it and the downloaded videos.
            </Text>
        </View>
    );
}

/** The chats with videos, found one by one; Saved Messages always first. */
function Chats({ name }: { name: string }) {
    const { colors } = useTheme();
    const navigation = useNavigation<Nav>();
    const [chats, setChats] = useState<TgChat[] | null>(null);
    const [looking, setLooking] = useState(true);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        setError('');
        setChats(null);
        setLooking(true);
        (async () => {
            const all = await TelegramService.chats(100);
            const shown = all.filter(c => c.saved);
            if (live) { setChats([...shown]); }
            for (const c of all) {
                if (!live) { return; }
                if (c.saved) { continue; }
                // ponytail: one search pair per chat, in turn. Stops quietly on an error (Telegram's
                // flood limit); page the probe if accounts with hundreds of chats hit it.
                const page = await TelegramService.videos(c.id, 0, PAGE).catch(() => null);
                if (!page) { break; }
                firstPages.set(c.id, page);
                if (page.items.length > 0 && live) {
                    shown.push(c);
                    setChats([...shown]);
                }
            }
        })()
            .catch(e => { if (live) { setError(errorText(e)); } })
            .finally(() => { if (live) { setLooking(false); } });
        return () => { live = false; };
    }, [attempt]);

    if (error) { return <EmptyState icon="wifi-off" text={error} action="Retry" onAction={() => setAttempt(n => n + 1)} />; }
    if (!chats) { return <Loader />; }
    return (
        <ScrollView contentContainerStyle={[styles.content, IS_TV && styles.contentTv]}>
            <SectionLabel title={name ? `Signed in as ${name}` : 'Chats'} />
            <ListGroup>
                {chats.map((c, i) => (
                    <ListRow
                        key={c.id}
                        preferFocus={i === 0}
                        icon={c.saved ? 'bookmark' : c.group ? 'users' : 'user'}
                        title={c.saved ? 'Saved Messages' : c.title}
                        caption={c.saved ? 'Forward videos here to watch them in Glide' : undefined}
                        chevron
                        onPress={() => navigation.navigate('TelegramChat', { chatId: c.id, title: c.saved ? 'Saved Messages' : c.title })}
                    />
                ))}
                {looking && <ListRow title="Looking for videos in your chats…" trailing={<ActivityIndicator size="small" color={colors.primary} />} />}
            </ListGroup>
        </ScrollView>
    );
}

const toFile = (v: TgVideo): VideoFile => ({
    name: v.name, path: v.uri, size: v.size, modifiedDate: v.date, duration: v.duration,
    width: v.width || undefined, height: v.height || undefined, isDirectory: false,
});

export function TelegramChatScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TelegramChat'>) {
    const { chatId, title } = route.params;
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const [films, setFilms] = useState<VideoFile[] | null>(null);
    const [error, setError] = useState('');
    const [more, setMore] = useState(false);
    // Cards on a TV, as in the library.
    const [grid, setGrid] = useState(IS_TV);
    const [selected, setSelected] = useState<VideoFile | null>(null);
    const next = useRef(0);
    const loading = useRef(false);

    const load = useCallback(async (first: boolean) => {
        if (loading.current || (!first && next.current === 0)) { return; }
        loading.current = true;
        setError('');
        try {
            const cached = first ? firstPages.get(chatId) : undefined;
            firstPages.delete(chatId);
            const page = cached ?? await TelegramService.videos(chatId, first ? 0 : next.current, PAGE);
            next.current = page.next;
            setMore(page.next !== 0);
            setFilms(f => [...(first ? [] : f ?? []), ...page.items.map(toFile)]);
        } catch (e) {
            setError(errorText(e));
        } finally {
            loading.current = false;
        }
    }, [chatId]);

    useEffect(() => { load(true); }, [load]);

    const play = useCallback((film: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, film.path, { videoName: film.name });
    }, [navigation]);

    const renderItem = useCallback(({ item, index }: { item: VideoFile; index: number }) => {
        const Item: VideoItemComponent = grid ? VideoCard : VideoRow;
        return (
            <VideoItemCell grid={grid}>
                <Item
                    item={item}
                    path={item.path}
                    name={item.name}
                    duration={item.duration}
                    meta={formatFileSize(item.size)}
                    onPress={play}
                    onMore={setSelected}
                    preferFocus={index === 0}
                />
            </VideoItemCell>
        );
    }, [grid, play]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <ListHeader title={title} onBack={navigation.goBack}>
                <IconButton
                    icon={grid ? 'list' : 'grid'}
                    onPress={() => setGrid(!grid)}
                    accessibilityLabel={grid ? 'Switch to list view' : 'Switch to grid view'}
                />
            </ListHeader>
            {error && !films?.length ? (
                <EmptyState icon="wifi-off" text={error} action="Retry" onAction={() => load(true)} />
            ) : !films ? (
                <Loader />
            ) : films.length === 0 ? (
                <EmptyState icon="send" text={title === 'Saved Messages'
                    ? 'No videos yet. In Telegram, forward a video to Saved Messages and it shows up here.'
                    : 'No videos in this chat.'} />
            ) : (
                <FlashList
                    data={films}
                    renderItem={renderItem}
                    keyExtractor={(item: VideoFile) => item.path}
                    numColumns={grid ? metrics.grid.columns : 1}
                    key={String(grid)}
                    onEndReached={() => load(false)}
                    onEndReachedThreshold={1}
                    ListFooterComponent={more ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
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
    form: { gap: metrics.space.md, paddingTop: metrics.space.md },
    intro: { gap: metrics.space.sm },
    qrRow: { flexDirection: 'row', gap: metrics.space.lg, alignItems: 'center' },
    // White around the code is the quiet zone a camera needs to find it.
    qr: { width: 200, height: 200, borderRadius: metrics.radius.md },
    qrText: { flex: 1, gap: metrics.space.sm },
    footer: { padding: metrics.space.lg },
});
