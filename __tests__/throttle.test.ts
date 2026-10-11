import { describe, expect, it, jest } from '@jest/globals';
import { throttle } from '../src/hooks/video-player/types';

describe('throttle', () => {
    it('sends the first value at once, the latest per window, and the last on flush', () => {
        jest.useFakeTimers();
        const sent: number[] = [];
        const send = throttle((v: number) => sent.push(v), 100);

        send(1);
        send(2);
        send(3);
        expect(sent).toEqual([1]);

        jest.advanceTimersByTime(100);
        expect(sent).toEqual([1, 3]);

        send(4);
        send(5);
        send.flush();
        expect(sent).toEqual([1, 3, 5]);

        jest.advanceTimersByTime(500);
        expect(sent).toEqual([1, 3, 5]);
        jest.useRealTimers();
    });
});
