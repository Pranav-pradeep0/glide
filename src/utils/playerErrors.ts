/**
 * Media3 error code names, grouped into what a person can act on. `server`: the share's host,
 * for a video on a network share.
 */
export function describePlayerError(code: string, server?: string): { title: string; body: string } {
    if (/LOCAL_NETWORK_DENIED/.test(code)) {
        return { title: 'Allow nearby devices', body: 'Glide needs it to reach computers on your network. Turn it on in app settings.' };
    }
    if (server && /NETWORK|TIMEOUT/.test(code)) {
        return { title: `Can't reach ${server}`, body: 'Check that the computer is on and on the same network.' };
    }
    if (/FILE_NOT_FOUND/.test(code)) {
        return { title: 'File not found', body: 'It may have been moved, renamed or deleted.' };
    }
    if (/NO_PERMISSION/.test(code)) {
        return { title: "Can't open this file", body: 'Glide does not have permission to read it.' };
    }
    if (/NETWORK|HTTP|TIMEOUT|CLEARTEXT/.test(code)) {
        return { title: "Can't reach the video", body: 'Check your connection and try again.' };
    }
    if (/MALFORMED/.test(code)) {
        return { title: 'This file looks damaged', body: 'Part of it could not be read. It may be incomplete.' };
    }
    if (/AUDIO_UNSUPPORTED/.test(code)) {
        return { title: "Can't play this video's sound", body: 'Its audio format is not supported. Retry plays the picture without sound.' };
    }
    if (/UNSUPPORTED|EXCEEDS_CAPABILITIES|DECODER|DECODING/.test(code)) {
        return { title: "Your device can't play this video", body: 'Its format or resolution is beyond what the decoder supports.' };
    }
    if (/AUDIO_TRACK/.test(code)) {
        return { title: "Sound couldn't start", body: 'Another app may be holding the audio output.' };
    }
    if (/DRM/.test(code)) {
        return { title: 'This video is protected', body: 'Glide cannot play copy-protected files.' };
    }
    return { title: "This video couldn't be played", body: 'Something went wrong while playing it.' };
}

/** GL failures from colour enhancement: recoverable by switching it off. */
export const isEnhancementError = (code: string) => /VIDEO_FRAME_PROCESS/.test(code);
