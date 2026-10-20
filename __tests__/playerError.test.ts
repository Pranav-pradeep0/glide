import { describe, expect, it } from '@jest/globals';
import { describePlayerError, isEnhancementError } from '../src/utils/playerErrors';

describe('describePlayerError', () => {
    it.each([
        ['ERROR_CODE_IO_FILE_NOT_FOUND', 'File not found'],
        ['ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', "Can't reach the video"],
        ['ERROR_CODE_PARSING_CONTAINER_MALFORMED', 'This file looks damaged'],
        ['ERROR_CODE_DECODING_FORMAT_UNSUPPORTED', "Your device can't play this video"],
        ['ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES', "Your device can't play this video"],
        ['ERROR_CODE_AUDIO_TRACK_INIT_FAILED', "Sound couldn't start"],
        ['ERROR_CODE_AUDIO_UNSUPPORTED', "Can't play this video's sound"],
        ['ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED', 'This video is protected'],
        ['Playback error', "This video couldn't be played"],
    ])('%s', (code, title) => {
        expect(describePlayerError(code).title).toBe(title);
    });

    it('spots colour enhancement GL failures', () => {
        expect(isEnhancementError('ERROR_CODE_VIDEO_FRAME_PROCESSOR_INIT_FAILED')).toBe(true);
        expect(isEnhancementError('ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED')).toBe(true);
        expect(isEnhancementError('ERROR_CODE_DECODING_FAILED')).toBe(false);
    });
});
