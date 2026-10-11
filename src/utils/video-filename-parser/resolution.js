/* eslint-disable no-shadow */
import { parseSource, Source } from './source.js';
import { execFirst } from './utils.js';
export var Resolution;
(function (Resolution) {
    Resolution.R2160P = '2160P';
    Resolution.R1080P = '1080P';
    Resolution.R720P = '720P';
    Resolution.R576P = '576P';
    Resolution.R540P = '540P';
    Resolution.R480P = '480P';
})(Resolution || (Resolution = {}));
const R2160pExp = /(?<R2160P>2160p|4k[-_. ](?:UHD|HEVC|BD)|(?:UHD|HEVC|BD)[-_. ]4k|\b(4k)\b|COMPLETE.UHD|UHD.COMPLETE)/i;
const R1080pExp = /(?<R1080P>1080(i|p)|1920x1080)(10bit)?/i;
const R720pExp = /(?<R720P>720(i|p)|1280x720|960p)(10bit)?/i;
const R576pExp = /(?<R576P>576(i|p))/i;
const R540pExp = /(?<R540P>540(i|p))/i;
const R480Exp = /(?<R480P>480(i|p)|640x480|848x480)/i;
const resolutionExps = [R2160pExp, R1080pExp, R720pExp, R576pExp, R540pExp, R480Exp];
export function parseResolution(title) {
    const result = execFirst(title, resolutionExps);
    if (result?.groups) {
        for (const key of Object.keys(Resolution)) {
            if (result.groups[key] !== undefined) {
                return {
                    resolution: Resolution[key],
                    source: result.groups[key],
                };
            }
        }
    }
    // Fallback to guessing from some sources
    // Make safe assumptions like dvdrip is probably 480p
    const source = parseSource(title);
    if (source.includes(Source.DVD)) {
        return { resolution: Resolution.R480P };
    }
    return {};
}
