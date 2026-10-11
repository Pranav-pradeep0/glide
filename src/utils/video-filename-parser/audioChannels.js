/* eslint-disable no-shadow */
import { execFirst } from './utils.js';
const eightChannelExp = /\b(?<eight>7.?[01])\b/i;
const sixChannelExp = /\b(?<six>(6[\W]0(?:ch)?)(?=[^\d]|$)|(5[\W][01](?:ch)?)(?=[^\d]|$)|5ch|6ch)\b/i;
const stereoChannelExp = /(?<stereo>((2[\W]0(?:ch)?)(?=[^\d]|$))|(stereo))/i;
const monoChannelExp = /(?<mono>(1[\W]0(?:ch)?)(?=[^\\d]|$)|(mono)|(1ch))/i;
const channelExps = [eightChannelExp, sixChannelExp, stereoChannelExp, monoChannelExp];
export var Channels;
(function (Channels) {
    Channels.SEVEN = '7.1';
    Channels.SIX = '5.1';
    Channels.STEREO = 'stereo';
    Channels.MONO = 'mono';
})(Channels || (Channels = {}));
export function parseAudioChannels(title) {
    const channelResult = execFirst(title, channelExps);
    if (!channelResult?.groups) {
        return {};
    }
    const { groups } = channelResult;
    if (groups.eight) {
        return { channels: Channels.SEVEN, source: groups.eight };
    }
    if (groups.six) {
        return { channels: Channels.SIX, source: groups.six };
    }
    if (groups.stereo) {
        return { channels: Channels.STEREO, source: groups.stereo };
    }
    if (groups.mono) {
        return { channels: Channels.MONO, source: groups.mono };
    }
    return {};
}
