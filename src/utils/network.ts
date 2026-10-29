function createAbortError(message: string = 'The operation was aborted.'): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

/** What fetchWithTimeout throws when its time runs out (AbortSignal.timeout's reason). */
export function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TimeoutError';
}

export async function fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = 10000
): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    try {
        return await fetch(url, { ...init, signal });
    } catch (error) {
        // fetch rejects with a plain AbortError; the reason says whether time ran out.
        if (signal.aborted) {
            throw signal.reason;
        }
        throw error;
    }
}

export type InFlightRequest<T> = {
    controller: AbortController;
    consumers: number;
    promise: Promise<T>;
};

export function createCoalescedRequest<T>(
    inFlightRequests: Map<string, InFlightRequest<T>>,
    key: string,
    execute: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    let request = inFlightRequests.get(key);

    if (!request) {
        const controller = new AbortController();
        const promise = execute(controller.signal).finally(() => {
            inFlightRequests.delete(key);
        });

        request = {
            controller,
            consumers: 0,
            promise,
        };
        inFlightRequests.set(key, request);
    }

    const sharedRequest = request;
    sharedRequest.consumers += 1;

    return new Promise<T>((resolve, reject) => {
        let finished = false;

        const release = () => {
            if (finished) {return;}
            finished = true;
            sharedRequest.consumers = Math.max(0, sharedRequest.consumers - 1);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            if (sharedRequest.consumers === 0 && !sharedRequest.controller.signal.aborted) {
                sharedRequest.controller.abort();
            }
        };

        const onAbort = () => {
            release();
            reject(createAbortError());
        };

        if (signal?.aborted) {
            onAbort();
            return;
        }

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        sharedRequest.promise.then(
            (value) => {
                release();
                resolve(value);
            },
            (error) => {
                release();
                reject(error);
            }
        );
    });
}
