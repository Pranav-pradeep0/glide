//   BASE_URL=https://glide-proxy.glidemediaplayer.workers.dev node smoke.mjs

const base = process.env.BASE_URL?.replace(/\/$/, '');
if (!base) {
    console.error('Set BASE_URL to the deployed Worker URL.');
    process.exit(1);
}

let failures = 0;

async function check(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (e) {
        failures++;
        console.error(`FAIL ${name}: ${e.message}`);
    }
}

function expectStatus(res, status) {
    if (res.status !== status) {
        throw new Error(`expected ${status}, got ${res.status}`);
    }
}

async function readJson(res) {
    const body = await res.json();
    if (typeof body !== 'object' || body === null) {
        throw new Error('response was not a JSON object');
    }
    return body;
}

const dialogue =
    "I never thought it would end like this. You promised me the city would be safe. " +
    "Promises are made to be broken, and bridges are made to burn. Look around you — " +
    "everything we built is falling apart. Then we build it again, together, one stone at a time. " +
    "There is no time left to rebuild; the fleet arrives at dawn. Then dawn will find us ready.";

await check('GET /v1/recap -> 405', async () => {
    expectStatus(await fetch(`${base}/v1/recap`, { method: 'GET' }), 405);
});

await check('POST /v1/nope -> 404', async () => {
    expectStatus(await fetch(`${base}/v1/nope`, { method: 'POST' }), 404);
});

await check('recap happy path -> 200 with recap text', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue, title: 'Smoke Test' }),
    });
    expectStatus(res, 200);
    const body = await readJson(res);
    if (typeof body.recap !== 'string' || body.recap.length === 0) {
        throw new Error('missing recap text');
    }
});

await check('oversized dialogue -> 400', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue: 'a'.repeat(6000) }),
    });
    expectStatus(res, 400);
});

await check('oversized transport body -> 413', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue: 'a'.repeat(90000) }),
    });
    expectStatus(res, 413);
});

await check('invalid JSON -> 400', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
    });
    expectStatus(res, 400);
});

await check('omdb lookup -> 200 with a match (key held by the Worker)', async () => {
    const body = await readJson(await fetch(`${base}/v1/omdb?t=Inception&y=2010`));
    if (body.Response !== 'True') {
        throw new Error(`no match: ${body.Error}`);
    }
});

await check('subdl search -> 200, no key in links, zip downloads', async () => {
    const res = await fetch(`${base}/v1/subdl?film_name=Inception&type=movie&languages=EN&subs_per_page=3`);
    expectStatus(res, 200);
    const body = await readJson(res);
    if (!Array.isArray(body.subtitles) || body.subtitles.length === 0) {
        throw new Error('no subtitles');
    }
    if (JSON.stringify(body).includes('api_key')) {
        throw new Error('the SubDL key leaked into the response');
    }
    // What the app does next: fetch the zip from SubDL directly, with no key.
    const zip = await fetch(`https://dl.subdl.com${body.subtitles[0].url}`);
    expectStatus(zip, 200);
    const magic = new Uint8Array(await zip.arrayBuffer()).slice(0, 2);
    if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
        throw new Error('download is not a zip');
    }
});

await check('report without recap -> 400', async () => {
    const res = await fetch(`${base}/v1/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    expectStatus(res, 400);
});

// Rate limit is 6/60s per IP per location, so run this last.
await check('flood -> at least one 429 within limit window', async () => {
    let saw429 = false;
    for (let i = 0; i < 10; i++) {
        const res = await fetch(`${base}/v1/recap`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
        });
        if (res.status === 429) {
            saw429 = true;
            break;
        }
        if (res.status !== 200 && res.status !== 400) {
            throw new Error(`unexpected ${res.status} during flood`);
        }
    }
    if (!saw429) {
        throw new Error('no 429 after 10 rapid requests');
    }
});

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
