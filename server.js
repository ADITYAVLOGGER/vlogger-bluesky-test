const http = require("http");

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIG
// ============================================================
const MASTODON_ACCESS_TOKEN =
    process.env.MASTODON_ACCESS_TOKEN || "";
const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER;
const BSKY_PASSWORD = process.env.BSKY_PASSWORD;

const BSKY_PDS = "https://bsky.social";

const MAX_OUTPUT_LIMIT = 20;
const SEARCH_LIMIT = 50;

// ============================================================
// MASTODON CONFIG
// ============================================================

const MASTODON_TIMEOUT_MS = 8000;

const MASTODON_COUNTRY_CONFIG = {
    IN: {
        instances: [
            "mastodon.social"
        ]
    },

    JP: {
        instances: [
            "mstdn.jp"
        ]
    },

    DE: {
        instances: [
            "mastodon.social"
        ]
    },

    BR: {
        instances: [
            "mastodon.social"
        ]
    },

    AE: {
        instances: [
            "mastodon.social"
        ]
    },

    GLOBAL: {
        instances: [
            "mastodon.social"
        ]
    }
};

// ============================================================
// SESSION CACHE
// ============================================================

let cachedSession = null;
let sessionCreatedAt = 0;

// Refresh session before it becomes stale.
// If Bluesky rejects it, we automatically login again anyway.
const SESSION_CACHE_MS = 45 * 60 * 1000;

// ============================================================
// BASIC HELPERS
// ============================================================

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data, null, 2));
}

function cleanText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

function safeNumber(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// BLUESKY LOGIN
// ============================================================

async function createSession() {

    if (!BSKY_IDENTIFIER || !BSKY_PASSWORD) {
        throw new Error(
            "BSKY_IDENTIFIER or BSKY_PASSWORD is missing in Render Environment"
        );
    }

    console.log("🔐 Creating Bluesky session...");

    const response = await fetch(
        `${BSKY_PDS}/xrpc/com.atproto.server.createSession`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Vlogger/1.0"
            },

            body: JSON.stringify({
                identifier: BSKY_IDENTIFIER,
                password: BSKY_PASSWORD
            })
        }
    );

    const responseText = await response.text();

    console.log(
        `🔐 Bluesky login status=${response.status}`
    );

    if (!response.ok) {
        throw new Error(
            `Bluesky login failed: HTTP ${response.status} - ` +
            responseText.substring(0, 500)
        );
    }

    let session;

    try {
        session = JSON.parse(responseText);
    } catch {
        throw new Error(
            "Bluesky login response was not valid JSON"
        );
    }

    if (!session.accessJwt) {
        throw new Error(
            "Bluesky login succeeded but accessJwt is missing"
        );
    }

    cachedSession = session;
    sessionCreatedAt = Date.now();

    console.log(
        `✅ Bluesky authenticated | handle=${session.handle}`
    );

    return session;
}

async function getSession(forceRefresh = false) {

    const age =
        Date.now() - sessionCreatedAt;

    if (
        !forceRefresh &&
        cachedSession &&
        cachedSession.accessJwt &&
        age < SESSION_CACHE_MS
    ) {
        return cachedSession;
    }

    return createSession();
}

// ============================================================
// AUTHENTICATED BLUESKY REQUEST
// ============================================================

async function blueskyGet(path, params = {}) {

    let session = await getSession();

    async function execute(accessJwt) {

        const searchParams =
            new URLSearchParams();

        for (const [key, value] of Object.entries(params)) {

            if (
                value !== undefined &&
                value !== null &&
                value !== ""
            ) {
                searchParams.set(
                    key,
                    String(value)
                );
            }
        }

        const url =
            `${BSKY_PDS}/xrpc/${path}` +
            (
                searchParams.toString()
                    ? `?${searchParams.toString()}`
                    : ""
            );

        return fetch(url, {
            method: "GET",

            headers: {
                "Authorization":
                    `Bearer ${accessJwt}`,

                "Accept":
                    "application/json",

                "User-Agent":
                    "Vlogger/1.0"
            }
        });
    }

    let response =
        await execute(session.accessJwt);

    // Token expired / invalid.
    // Login once again and retry.
    if (
        response.status === 401 ||
        response.status === 403
    ) {

        console.log(
            `♻️ Bluesky auth retry | status=${response.status}`
        );

        session =
            await getSession(true);

        response =
            await execute(session.accessJwt);
    }

    return response;
}

// ============================================================
// SEARCH
// ============================================================

async function searchPosts(query) {

    console.log(
        `🔎 BLUESKY SEARCH | query=${query}`
    );

    const response =
        await blueskyGet(
            "app.bsky.feed.searchPosts",
            {
                q: query,
                sort: "top",
                limit: SEARCH_LIMIT
            }
        );

    const responseText =
        await response.text();

    if (!response.ok) {

        console.log(
            `❌ BLUESKY SEARCH FAILED | query=${query} | status=${response.status}`
        );

        console.log(
            responseText.substring(0, 500)
        );

        return {
            query,
            status: response.status,
            posts: []
        };
    }

    let data;

    try {
        data = JSON.parse(responseText);
    } catch {

        console.log(
            `❌ INVALID JSON | query=${query}`
        );

        return {
            query,
            status: response.status,
            posts: []
        };
    }

    const posts =
        Array.isArray(data.posts)
            ? data.posts
            : [];

    console.log(
        `✅ BLUESKY SEARCH | query=${query} | posts=${posts.length}`
    );

    return {
        query,
        status: response.status,
        posts
    };
}

// ============================================================
// COUNTRY SEARCH QUERIES
// ============================================================

function getCountryQueries(countryCode) {

    const country =
        cleanText(countryCode)
            .toUpperCase();

    switch (country) {

        // ----------------------------------------------------
        // INDIA
        // ----------------------------------------------------

        case "IN":
            return [
                "india vlog",
                "hindi vlog",
                "indian vlog",
                "indian daily life",
                "day in my life india",
                "india travel vlog",
                "india food vlog",
                "street food india",
                "college life india",
                "daily routine india"
            ];

        // ----------------------------------------------------
        // JAPAN
        // ----------------------------------------------------

        case "JP":
            return [
                "japan vlog",
                "japanese vlog",
                "japan daily life",
                "day in my life japan",
                "tokyo vlog",
                "japan travel",
                "life in japan"
            ];

        // ----------------------------------------------------
        // UAE
        // ----------------------------------------------------

        case "AE":
            return [
                "dubai vlog",
                "uae vlog",
                "dubai daily life",
                "day in my life dubai",
                "life in dubai",
                "dubai travel",
                "dubai food"
            ];

        // ----------------------------------------------------
        // SOUTH KOREA
        // ----------------------------------------------------

        case "KR":
            return [
                "korea vlog",
                "korean vlog",
                "seoul vlog",
                "korea daily life",
                "life in korea"
            ];

        // ----------------------------------------------------
        // UNITED STATES
        // ----------------------------------------------------

        case "US":
            return [
                "usa vlog",
                "american vlog",
                "daily vlog",
                "day in my life",
                "life in america",
                "usa travel"
            ];

        // ----------------------------------------------------
        // UNITED KINGDOM
        // ----------------------------------------------------

        case "GB":
            return [
                "uk vlog",
                "british vlog",
                "london vlog",
                "daily life uk",
                "life in london"
            ];

        // ----------------------------------------------------
        // GERMANY
        // ----------------------------------------------------

        case "DE":
            return [
                "germany vlog",
                "german vlog",
                "berlin vlog",
                "daily life germany",
                "leben in deutschland"
            ];

        // ----------------------------------------------------
        // FRANCE
        // ----------------------------------------------------

        case "FR":
            return [
                "france vlog",
                "french vlog",
                "paris vlog",
                "daily life france"
            ];

        // ----------------------------------------------------
        // BRAZIL
        // ----------------------------------------------------

        case "BR":
            return [
                "brazil vlog",
                "brasil vlog",
                "daily life brazil",
                "vida no brasil"
            ];

        // ----------------------------------------------------
        // GENERIC
        // ----------------------------------------------------

        default:
            return [
                "daily vlog",
                "day in my life",
                "travel vlog",
                "food vlog",
                "daily life",
                "weekend vlog"
            ];
    }
}

// ============================================================
// VIDEO EXTRACTION
// ============================================================

function extractVideo(post) {

    const embed = post?.embed;

    if (!embed) {
        return null;
    }

    /*
     * Bluesky video view can expose playlist directly.
     * We ONLY accept an embed where a playable playlist
     * actually exists.
     */

    const playlist =
        cleanText(embed?.playlist) ||
        cleanText(embed?.video?.playlist);

    if (!playlist) {
        return null;
    }

    const thumbnail =
        cleanText(embed?.thumbnail) ||
        cleanText(embed?.video?.thumbnail) ||
        null;

    return {
        playlist,
        thumbnail
    };
}

// ============================================================
// TEXT
// ============================================================

function getPostText(post) {

    return cleanText(
        post?.record?.text
    );
}

// ============================================================
// HARD SAFETY / NON-VLOG FILTER
// ============================================================

function containsBlockedContent(text) {

    const value =
        text.toLowerCase();

    const blocked = [

        // News / politics
        "breaking news",
        "breaking:",
        "election",
        "politics",
        "political",
        "president",
        "prime minister",
        "government",
        "protester",
        "protesters",
        "parliament",

        // Gaming
        "gameplay",
        "walkthrough",
        "gaming stream",
        "let's play",
        "lets play",

        // Tutorial / educational
        "tutorial",
        "how to ",
        "course ",
        "lesson ",
        "lecture ",

        // Reviews
        "unboxing",
        "product review",
        "tech review",

        // Entertainment copies
        "movie trailer",
        "official trailer",
        "full movie",
        "episode ",
        "season ",
        "music video",
        "official music",

        // Podcast
        "podcast",
        "full interview"
    ];

    return blocked.some(
        word => value.includes(word)
    );
}

// ============================================================
// VLOG SCORE
// ============================================================

function calculateVlogScore(post) {

    const text =
        getPostText(post)
            .toLowerCase();

    if (!text) {
        return 0;
    }

    if (containsBlockedContent(text)) {
        return 0;
    }

    let score = 15;

    const strongSignals = [
        "vlog",
        "vlogging",
        "daily vlog",
        "mini vlog",
        "travel vlog",
        "food vlog",
        "weekend vlog"
    ];

    const lifestyleSignals = [
        "day in my life",
        "daily life",
        "my day",
        "morning routine",
        "evening routine",
        "daily routine",
        "college life",
        "student life",
        "work life",
        "life in ",
        "living in ",
        "street food",
        "cafe",
        "café",
        "road trip",
        "vacation",
        "holiday",
        "journey",
        "weekend",
        "travel",
        "trip",
        "grwm",
        "get ready with me"
    ];

    const personalSignals = [
        "my ",
        "today",
        "we went",
        "i went",
        "i visited",
        "we visited",
        "our trip",
        "my trip",
        "my life"
    ];

    for (const signal of strongSignals) {

        if (text.includes(signal)) {
            score += 30;
        }
    }

    for (const signal of lifestyleSignals) {

        if (text.includes(signal)) {
            score += 15;
        }
    }

    for (const signal of personalSignals) {

        if (text.includes(signal)) {
            score += 10;
        }
    }

    return Math.min(score, 100);
}

// ============================================================
// COUNTRY SCORE
// ============================================================

function calculateCountryScore(
    post,
    countryCode
) {

    const text =
        getPostText(post)
            .toLowerCase();

    const language =
        Array.isArray(post?.record?.langs)
            ? cleanText(post.record.langs[0])
                  .toLowerCase()
            : "";

    let score = 0;

    switch (
        cleanText(countryCode).toUpperCase()
    ) {

        // ----------------------------------------------------
        // INDIA
        // ----------------------------------------------------

        case "IN": {

            const strong = [
                "india",
                "indian",
                "भारत",
                "हिंदी",
                "hindustan"
            ];

            const cities = [
                "delhi",
                "new delhi",
                "mumbai",
                "patna",
                "bihar",
                "kolkata",
                "chennai",
                "bangalore",
                "bengaluru",
                "hyderabad",
                "pune",
                "jaipur",
                "lucknow",
                "varanasi",
                "punjab",
                "kerala",
                "gujarat",
                "rajasthan",
                "uttar pradesh"
            ];

            for (const signal of strong) {

                if (text.includes(signal)) {
                    score += 30;
                }
            }

            for (const city of cities) {

                if (text.includes(city)) {
                    score += 20;
                }
            }

            if (
                language === "hi" ||
                language.startsWith("hi-")
            ) {
                score += 25;
            }

            break;
        }

        // ----------------------------------------------------
        // JAPAN
        // ----------------------------------------------------

        case "JP": {

            const signals = [
                "japan",
                "japanese",
                "tokyo",
                "osaka",
                "kyoto",
                "日本",
                "東京"
            ];

            for (const signal of signals) {

                if (text.includes(signal)) {
                    score += 25;
                }
            }

            if (language === "ja") {
                score += 25;
            }

            break;
        }

        // ----------------------------------------------------
        // UAE
        // ----------------------------------------------------

        case "AE": {

            const signals = [
                "uae",
                "dubai",
                "abu dhabi",
                "sharjah",
                "emirates"
            ];

            for (const signal of signals) {

                if (text.includes(signal)) {
                    score += 30;
                }
            }

            break;
        }

        default:
            score = 10;
    }

    return Math.min(score, 100);
}

// ============================================================
// ENGAGEMENT
// ============================================================

function calculateEngagement(post) {

    const likes =
        safeNumber(post?.likeCount);

    const reposts =
        safeNumber(post?.repostCount);

    const replies =
        safeNumber(post?.replyCount);

    const quotes =
        safeNumber(post?.quoteCount);

    return (
        likes +
        (reposts * 2.5) +
        (replies * 1.5) +
        (quotes * 2)
    );
}

// ============================================================
// ORIGINAL BLUESKY URL
// ============================================================

function createOriginalPostUrl(post) {

    const handle =
        cleanText(post?.author?.handle);

    const uri =
        cleanText(post?.uri);

    if (!handle || !uri) {
        return null;
    }

    const parts =
        uri.split("/");

    const rkey =
        parts[parts.length - 1];

    if (!rkey) {
        return null;
    }

    return (
        `https://bsky.app/profile/` +
        `${encodeURIComponent(handle)}/post/` +
        `${encodeURIComponent(rkey)}`
    );
}

// ============================================================
// CONVERT POST
// ============================================================

function convertPost(
    post,
    video,
    countryCode,
    matchedQuery
) {

    const author =
        post?.author || {};

    const vlogScore =
        calculateVlogScore(post);

    const countryScore =
        calculateCountryScore(
            post,
            countryCode
        );

    const engagementScore =
        calculateEngagement(post);

    const languages =
        Array.isArray(post?.record?.langs)
            ? post.record.langs
            : [];

    return {

        id:
            cleanText(post?.uri),

        provider:
            "bluesky",

        // ------------------------------------------
        // VIDEO
        // ------------------------------------------

        videoUrl:
            video.playlist,

        thumbnailUrl:
            video.thumbnail,

        // ------------------------------------------
        // CONTENT
        // ------------------------------------------

        caption:
            getPostText(post),

        language:
            languages.length > 0
                ? languages[0]
                : null,

        // ------------------------------------------
        // CREATOR
        // ------------------------------------------

        creatorId:
            cleanText(author?.did),

        creatorName:
            cleanText(author?.displayName) ||
            cleanText(author?.handle) ||
            "Bluesky Creator",

        creatorHandle:
            cleanText(author?.handle),

        creatorAvatar:
            cleanText(author?.avatar) ||
            null,

        // ------------------------------------------
        // ORIGINAL SOURCE
        // ------------------------------------------

        originalPostUrl:
            createOriginalPostUrl(post),

        // ------------------------------------------
        // RANKING
        // ------------------------------------------

        countryCode:
            cleanText(countryCode)
                .toUpperCase(),

        countryScore,

        vlogScore,

        engagementScore,

        // ------------------------------------------
        // RAW ENGAGEMENT
        // ------------------------------------------

        likes:
            safeNumber(post?.likeCount),

        comments:
            safeNumber(post?.replyCount),

        shares:
            safeNumber(post?.repostCount),

        quotes:
            safeNumber(post?.quoteCount),

        // ------------------------------------------
        // DEBUG
        // ------------------------------------------

        matchedQuery,

        indexedAt:
            post?.indexedAt || null
    };
}

// ============================================================
// FETCH BLUESKY VLOGS
// ============================================================

async function fetchBlueskyVlogs(
    countryCode,
    requestedLimit
) {

    const queries =
        getCountryQueries(countryCode);

    const unique =
        new Map();

    const debug = {

        searchesAttempted: 0,

        searchesSuccessful: 0,

        postsReceived: 0,

        duplicates: 0,

        noVideo: 0,

        videosFound: 0,

        blocked: 0,

        vlogRejected: 0,

        vlogPassed: 0
    };

    /*
     * We don't necessarily need every query.
     *
     * Once we have enough candidates,
     * stop searching.
     */

    for (const query of queries) {

        debug.searchesAttempted++;

        const result =
            await searchPosts(query);

        if (result.status === 200) {
            debug.searchesSuccessful++;
        }

        debug.postsReceived +=
            result.posts.length;

        for (const post of result.posts) {

            const id =
                cleanText(post?.uri);

            if (!id) {
                continue;
            }

            if (unique.has(id)) {

                debug.duplicates++;

                continue;
            }

            const video =
                extractVideo(post);

            if (!video) {

                debug.noVideo++;

                continue;
            }

            debug.videosFound++;

            const text =
                getPostText(post);

            if (
                containsBlockedContent(
                    text
                )
            ) {

                debug.blocked++;

                continue;
            }

            const vlogScore =
                calculateVlogScore(post);

            /*
             * High recall:
             *
             * We don't require literal "vlog".
             * Lifestyle/personal content can pass.
             */

            if (vlogScore < 30) {

                debug.vlogRejected++;

                continue;
            }

            debug.vlogPassed++;

            const candidate =
                convertPost(
                    post,
                    video,
                    countryCode,
                    query
                );

            unique.set(
                id,
                candidate
            );
        }

        /*
         * Keep some extra candidates
         * so ranking has choices.
         */

        if (
            unique.size >=
            requestedLimit * 3
        ) {
            break;
        }

        /*
         * Small delay to avoid unnecessarily
         * hammering search endpoint.
         */

        await sleep(100);
    }

    // ========================================================
    // RANK
    // ========================================================

    const ranked =
        Array.from(unique.values())
            .sort((a, b) => {

                /*
                 * Primary:
                 * vlog relevance
                 */

                if (
                    b.vlogScore !==
                    a.vlogScore
                ) {
                    return (
                        b.vlogScore -
                        a.vlogScore
                    );
                }

                /*
                 * Secondary:
                 * country relevance
                 */

                if (
                    b.countryScore !==
                    a.countryScore
                ) {
                    return (
                        b.countryScore -
                        a.countryScore
                    );
                }

                /*
                 * Third:
                 * engagement
                 */

                return (
                    b.engagementScore -
                    a.engagementScore
                );
            });

    // ========================================================
    // COUNTRY TIERS
    // ========================================================

    const strongCountry =
        ranked.filter(
            item =>
                item.countryScore >= 60
        );

    const possibleCountry =
        ranked.filter(
            item =>
                item.countryScore >= 30 &&
                item.countryScore < 60
        );

    const weakCountry =
        ranked.filter(
            item =>
                item.countryScore < 30
        );

    /*
     * IMPORTANT:
     *
     * Don't return zero just because
     * strong-country inventory is low.
     *
     * Strong first → possible → weak fallback.
     */

    const final =
        [
            ...strongCountry,
            ...possibleCountry,
            ...weakCountry
        ]
            .slice(
                0,
                requestedLimit
            );

    return {

        debug,

        tiers: {
            strongCountry:
                strongCountry.length,

            possibleCountry:
                possibleCountry.length,

            weakCountry:
                weakCountry.length
        },

        videos:
            final
    };
}

// ============================================================
// SERVER
// ============================================================

const server =
    http.createServer(
        async (req, res) => {

            try {

                const requestUrl =
                    new URL(
                        req.url,
                        `http://${req.headers.host || "localhost"}`
                    );

                // ==================================================
                // HOME
                // ==================================================

                if (
                    requestUrl.pathname === "/"
                ) {

                    return sendJson(
                        res,
                        200,
                        {
                            status:
                                "Vlogger Bluesky API Running",

                           endpoints: {

    health:
        "/health",

    bluesky:
        "/api/bluesky/vlogs?country=IN&limit=10",

    mastodon:
        "/api/mastodon/vlogs?country=IN&limit=10"
}
                        }
                    );
                }

                // ==================================================
                // HEALTH
                // ==================================================

                if (
                    requestUrl.pathname ===
                    "/health"
                ) {

                    return sendJson(
                        res,
                        200,
                        {
                            status: "ok",
                            service:
                                "vlogger-bluesky-api"
                        }
                    );
                }

                // ==================================================
                // VLOG API
                // ==================================================

                if (
                    requestUrl.pathname ===
                    "/api/bluesky/vlogs"
                ) {

                    const country =
                        (
                            cleanText(
                                requestUrl
                                    .searchParams
                                    .get("country")
                            ) ||
                            "IN"
                        )
                            .toUpperCase()
                            .slice(0, 2);

                    const rawLimit =
                        Number(
                            requestUrl
                                .searchParams
                                .get("limit")
                        );

                    const limit =
                        Number.isFinite(rawLimit)
                            ? Math.min(
                                Math.max(
                                    Math.floor(rawLimit),
                                    1
                                ),
                                MAX_OUTPUT_LIMIT
                            )
                            : 10;

                    console.log("");
                    console.log(
                        "========================================"
                    );
                    console.log(
                        "🌍 VLOGGER BLUESKY REQUEST"
                    );
                    console.log(
                        `country=${country}`
                    );
                    console.log(
                        `limit=${limit}`
                    );
                    console.log(
                        "========================================"
                    );

                    const started =
                        Date.now();

                    const result =
                        await fetchBlueskyVlogs(
                            country,
                            limit
                        );

                    const duration =
                        Date.now() -
                        started;

                    console.log("");
                    console.log(
                        "🦋 BLUESKY FINAL"
                    );
                    console.log(
                        `country=${country}`
                    );
                    console.log(
                        `posts=${result.debug.postsReceived}`
                    );
                    console.log(
                        `videos=${result.debug.videosFound}`
                    );
                    console.log(
                        `vlogPassed=${result.debug.vlogPassed}`
                    );
                    console.log(
                        `returned=${result.videos.length}`
                    );
                    console.log(
                        `time=${duration}ms`
                    );

                    return sendJson(
                        res,
                        200,
                        {
                            status:
                                "success",

                            provider:
                                "bluesky",

                            country,

                            requested:
                                limit,

                            returned:
                                result.videos.length,

                            timeMs:
                                duration,

                            debug:
                                result.debug,

                            tiers:
                                result.tiers,

                            videos:
                                result.videos
                        }
                    );
                }

                // ==================================================
// MASTODON VLOG API
// ==================================================

if (
    requestUrl.pathname ===
    "/api/mastodon/vlogs"
) {

    const rawCountry =
        cleanText(
            requestUrl
                .searchParams
                .get("country")
        );


    const country =
        (
            rawCountry ||
            "IN"
        )
            .toUpperCase()
            .slice(0, 2);


    const rawLimit =
        Number(
            requestUrl
                .searchParams
                .get("limit")
        );


    const limit =
        Number.isFinite(rawLimit)
            ? Math.min(
                Math.max(
                    Math.floor(rawLimit),
                    1
                ),
                MAX_OUTPUT_LIMIT
            )
            : 10;


    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🐘 VLOGGER MASTODON REQUEST"
    );

    console.log(
        `country=${country}`
    );

    console.log(
        `limit=${limit}`
    );

    console.log(
        "========================================"
    );


    const started =
        Date.now();


    const result =
        await fetchMastodonVlogs(
            country,
            limit
        );


    const duration =
        Date.now() -
        started;


    console.log("");
    console.log(
        "🐘 MASTODON FINAL"
    );

    console.log(
        `country=${country}`
    );

    console.log(
        `instances=${result.instancesAttempted}`
    );

    console.log(
        `authRestricted=${result.authRestrictedInstances}`
    );

    console.log(
        `statuses=${result.statusesReceived}`
    );

    console.log(
        `strong=${result.strongCountry}`
    );

    console.log(
        `possible=${result.possibleCountry}`
    );

    console.log(
        `weak=${result.weakCountry}`
    );

    console.log(
        `returned=${result.videos.length}`
    );

    console.log(
        `time=${duration}ms`
    );


    return sendJson(
        res,
        200,
        {

            status:
                "success",

            provider:
                "mastodon",

            country,

            requested:
                limit,

            returned:
                result.videos.length,

            timeMs:
                duration,

            debug: {

                instancesAttempted:
                    result.instancesAttempted,

                authRestrictedInstances:
                    result.authRestrictedInstances,

                statusesReceived:
                    result.statusesReceived
            },

            tiers: {

                strongCountry:
                    result.strongCountry,

                possibleCountry:
                    result.possibleCountry,

                weakCountry:
                    result.weakCountry
            },

            videos:
                result.videos
        }
    );
}

                // ==================================================
                // 404
                // ==================================================

                return sendJson(
                    res,
                    404,
                    {
                        error:
                            "Not Found"
                    }
                );

            } catch (error) {

                console.error(
                    "❌ SERVER ERROR:",
                    error
                );

                return sendJson(
                    res,
                    500,
                    {
                        status:
                            "error",

                        message:
                            error.message
                    }
                );
            }
        }
    );

// ============================================================
// MASTODON HELPERS
// ============================================================

function stripHtml(value = "") {
    return String(value)
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}


function normalizeMastodonLanguage(language) {

    if (!language) {
        return null;
    }

    return String(language)
        .trim()
        .toLowerCase()
        .split("-")[0] || null;
}


function mastodonCountryConfig(countryCode) {

    const country =
        String(countryCode || "GLOBAL")
            .trim()
            .toUpperCase();

    return (
        MASTODON_COUNTRY_CONFIG[country] ||
        MASTODON_COUNTRY_CONFIG.GLOBAL
    );
}


function mastodonCountryWords(countryCode) {

    switch (
        String(countryCode || "")
            .toUpperCase()
    ) {

        case "IN":
            return {
                strong: [
                    "india",
                    "भारत",
                    "hindustan",
                    "delhi",
                    "mumbai",
                    "kolkata",
                    "chennai",
                    "bengaluru",
                    "bangalore",
                    "hyderabad",
                    "pune",
                    "patna",
                    "jaipur",
                    "lucknow",
                    "ahmedabad",
                    "chandigarh",
                    "bhopal",
                    "indore",
                    "surat",
                    "ranchi",
                    "kochi"
                ],

                weak: [
                    "indian"
                ],

                languages: [
                    "hi",
                    "bn",
                    "ta",
                    "te",
                    "mr",
                    "gu",
                    "kn",
                    "ml",
                    "pa"
                ]
            };


        case "JP":
            return {
                strong: [
                    "japan",
                    "日本",
                    "tokyo",
                    "東京",
                    "osaka",
                    "大阪",
                    "kyoto",
                    "京都"
                ],

                weak: [
                    "japanese",
                    "日本人"
                ],

                languages: [
                    "ja"
                ]
            };


        case "DE":
            return {
                strong: [
                    "germany",
                    "deutschland",
                    "berlin",
                    "munich",
                    "münchen",
                    "hamburg",
                    "frankfurt",
                    "cologne",
                    "köln"
                ],

                weak: [
                    "german",
                    "deutsch"
                ],

                languages: [
                    "de"
                ]
            };


        case "BR":
            return {
                strong: [
                    "brazil",
                    "brasil",
                    "sao paulo",
                    "são paulo",
                    "rio de janeiro",
                    "brasilia",
                    "brasília",
                    "salvador"
                ],

                weak: [
                    "brazilian",
                    "brasileiro",
                    "brasileira"
                ],

                languages: [
                    "pt"
                ]
            };


        case "AE":
            return {
                strong: [
                    "uae",
                    "united arab emirates",
                    "الإمارات",
                    "dubai",
                    "دبي",
                    "abu dhabi",
                    "أبوظبي",
                    "sharjah"
                ],

                weak: [
                    "emirates"
                ],

                languages: [
                    "ar"
                ]
            };


        default:
            return {
                strong: [],
                weak: [],
                languages: []
            };
    }
}


function calculateMastodonCountryScore(
    countryCode,
    text,
    language
) {

    const config =
        mastodonCountryWords(countryCode);

    const lower =
        String(text || "")
            .toLowerCase();

    let score = 0;


    // Strong geographic evidence
    for (const word of config.strong) {

        if (
            lower.includes(
                String(word).toLowerCase()
            )
        ) {

            score += 35;
        }
    }


    // Weak words like "Indian" should NOT by themselves
    // prove that creator/post is actually located in India.
    for (const word of config.weak) {

        if (
            lower.includes(
                String(word).toLowerCase()
            )
        ) {

            score += 10;
        }
    }


    const lang =
        normalizeMastodonLanguage(
            language
        );


    if (
        lang &&
        config.languages.includes(lang)
    ) {

        score += 20;
    }


    return Math.min(
        100,
        score
    );
}


function calculateMastodonVlogScore(
    text,
    tags = []
) {

    const combined =
        (
            String(text || "") +
            " " +
            tags.join(" ")
        )
            .toLowerCase();


    const hardBlocks = [
        "gameplay",
        "walkthrough",
        "gaming",
        "tutorial",
        "how to",
        "course",
        "podcast",
        "trailer",
        "movie trailer",
        "episode",
        "full movie",
        "music video",
        "official audio",
        "album",
        "unboxing",
        "product review",
        "news update",
        "breaking news",
        "screen recording"
    ];


    if (
        hardBlocks.some(
            word => combined.includes(word)
        )
    ) {

        return 0;
    }


    let score = 20;


    const vlogSignals = [
        "vlog",
        "vlogging",
        "daily life",
        "day in my life",
        "my day",
        "today",
        "my trip",
        "travel",
        "travel diary",
        "trip",
        "vacation",
        "holiday",
        "journey",
        "street food",
        "food trip",
        "cafe",
        "restaurant",
        "college life",
        "campus",
        "student life",
        "work day",
        "routine",
        "morning routine",
        "evening routine",
        "weekend",
        "city walk",
        "road trip",
        "shopping",
        "family",
        "grwm",
        "behind the scenes",
        "life in",
        "living in"
    ];


    for (const signal of vlogSignals) {

        if (
            combined.includes(signal)
        ) {

            score += 15;
        }
    }


    return Math.min(
        100,
        score
    );
}

async function fetchMastodonInstance(
    host,
    countryCode
) {

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            MASTODON_TIMEOUT_MS
        );


    try {

        const url =
            `https://${host}/api/v1/timelines/public` +
            `?local=false` +
            `&only_media=true` +
            `&limit=40`;


        const response =
            await fetch(
                url,
                {
                    method: "GET",

                    // headers: {
                    //     "Accept":
                    //         "application/json",

                    //     "User-Agent":
                    //         "Vlogger/1.0"
                    // },
                    headers: {
    "Accept":
        "application/json",

    "User-Agent":
        "Vlogger/1.0",

    "Authorization":
        `Bearer ${MASTODON_ACCESS_TOKEN}`
},

                    signal:
                        controller.signal
                }
            );


        const body =
            await response.text();


        // ================================================
        // AUTH REQUIRED
        // ================================================

        if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 422
        ) {

            console.log(
                `🐘 MASTODON AUTH/SERVER RESTRICTED | host=${host} | status=${response.status}`
            );

            return {
                host,
                status: response.status,
                authRequired: true,
                statuses: []
            };
        }


        if (!response.ok) {

            console.log(
                `❌ MASTODON HTTP | host=${host} | status=${response.status} | body=${body.slice(0, 200)}`
            );

            return {
                host,
                status: response.status,
                authRequired: false,
                statuses: []
            };
        }


        let json;


        try {

            json =
                JSON.parse(body);

        } catch (error) {

            console.log(
                `❌ MASTODON JSON ERROR | host=${host}`
            );

            return {
                host,
                status: response.status,
                authRequired: false,
                statuses: []
            };
        }


        if (!Array.isArray(json)) {

            return {
                host,
                status: response.status,
                authRequired: false,
                statuses: []
            };
        }


        console.log(
            `🐘 MASTODON OK | host=${host} | statuses=${json.length}`
        );


        return {
            host,
            status: response.status,
            authRequired: false,
            statuses: json
        };


    } catch (error) {

        console.log(
            `❌ MASTODON FETCH FAILED | host=${host} | ${error.message}`
        );


        return {
            host,
            status: 0,
            authRequired: false,
            statuses: []
        };


    } finally {

        clearTimeout(timer);
    }
}

function convertMastodonStatus(
    status,
    host,
    countryCode
) {

    if (!status) {
        return null;
    }


    if (status.sensitive === true) {
        return null;
    }


    if (status.account?.bot === true) {
        return null;
    }


    const attachments =
        Array.isArray(
            status.media_attachments
        )
            ? status.media_attachments
            : [];


    const video =
        attachments.find(
            item =>
                String(item?.type || "")
                    .toLowerCase() === "video"
        );


    if (!video) {
        return null;
    }


    const videoUrl =
        String(
            video.url ||
            video.remote_url ||
            ""
        ).trim();


    if (!videoUrl) {
        return null;
    }


    const description =
        stripHtml(
            status.content || ""
        );


    const tags =
        Array.isArray(status.tags)
            ? status.tags
                .map(tag =>
                    String(tag?.name || "")
                        .trim()
                )
                .filter(Boolean)
            : [];


    const vlogScore =
        calculateMastodonVlogScore(
            description,
            tags
        );


    if (vlogScore < 35) {
        return null;
    }


    const language =
        normalizeMastodonLanguage(
            status.language
        );


    const creatorBio =
        stripHtml(
            status.account?.note || ""
        );


    const countryText =
        [
            description,
            creatorBio,
            tags.join(" ")
        ].join(" ");


    const countryScore =
        calculateMastodonCountryScore(
            countryCode,
            countryText,
            language
        );


    const likes =
        Number(
            status.favourites_count || 0
        );


    const comments =
        Number(
            status.replies_count || 0
        );


    const shares =
        Number(
            status.reblogs_count || 0
        );


    const engagementScore =
        likes +
        shares * 3 +
        comments * 2;


    const creatorName =
        String(
            status.account?.display_name ||
            status.account?.username ||
            "Mastodon Creator"
        ).trim();


    return {

        id:
            `mastodon_${host}_${status.id}`,

        provider:
            "mastodon",

        videoUrl,

        thumbnailUrl:
            video.preview_url || null,

        caption:
            description,

        language,

        creatorId:
            String(
                status.account?.id || ""
            ),

        creatorName,

        creatorHandle:
            String(
                status.account?.acct ||
                status.account?.username ||
                ""
            ),

        creatorAvatar:
            status.account?.avatar || null,

        originalPostUrl:
            status.url || null,

        countryCode:
            countryScore >= 60
                ? countryCode
                : null,

        countryScore,

        vlogScore,

        engagementScore,

        likes,

        comments,

        shares,

        indexedAt:
            status.created_at || null,

        sourceHost:
            host
    };
}

async function fetchMastodonVlogs(
    countryCode,
    requestedLimit
) {

    const country =
        String(countryCode || "GLOBAL")
            .trim()
            .toUpperCase();


    const limit =
        Math.max(
            1,
            Math.min(
                Number(requestedLimit) || 10,
                30
            )
        );


    const config =
        mastodonCountryConfig(
            country
        );


    const hosts =
        [
            ...new Set(
                config.instances
            )
        ]
            .slice(0, 3);


    const results =
        await Promise.all(
            hosts.map(
                host =>
                    fetchMastodonInstance(
                        host,
                        country
                    )
            )
        );


    const videos = [];

    let statusesReceived = 0;
    let authRestrictedInstances = 0;


    for (const result of results) {

        statusesReceived +=
            result.statuses.length;


        if (result.authRequired) {

            authRestrictedInstances++;

            continue;
        }


        for (
            const status of result.statuses
        ) {

            const video =
                convertMastodonStatus(
                    status,
                    result.host,
                    country
                );


            if (video) {

                videos.push(video);
            }
        }
    }


    // ================================================
    // DUPLICATE ID
    // ================================================

    const uniqueMap =
        new Map();


    for (const video of videos) {

        if (
            !uniqueMap.has(video.id)
        ) {

            uniqueMap.set(
                video.id,
                video
            );
        }
    }


    const unique =
        Array.from(
            uniqueMap.values()
        );


    // ================================================
    // RANK
    // ================================================

    unique.sort(
        (a, b) => {

            if (
                b.countryScore !==
                a.countryScore
            ) {

                return (
                    b.countryScore -
                    a.countryScore
                );
            }


            if (
                b.vlogScore !==
                a.vlogScore
            ) {

                return (
                    b.vlogScore -
                    a.vlogScore
                );
            }


            return (
                b.engagementScore -
                a.engagementScore
            );
        }
    );


    const strong =
        unique.filter(
            item =>
                item.countryScore >= 60
        );


    const possible =
        unique.filter(
            item =>
                item.countryScore >= 35 &&
                item.countryScore < 60
        );


    const weak =
        unique.filter(
            item =>
                item.countryScore < 35
        );


    // Country first, but do not return 0 just because
    // not enough country-specific videos exist.

    const selected =
        [
            ...strong,
            ...possible,
            ...weak
        ]
            .slice(
                0,
                limit
            );


    return {

        country,

        requested:
            limit,

        instancesAttempted:
            hosts.length,

        authRestrictedInstances,

        statusesReceived,

        strongCountry:
            strong.length,

        possibleCountry:
            possible.length,

        weakCountry:
            weak.length,

        videos:
            selected
    };
}

// ============================================================
// START
// ============================================================

server.listen(
    PORT,
    () => {

        console.log(
            `🚀 Vlogger Bluesky API running on port ${PORT}`
        );

    }
);








// const http = require("http");

// const PORT = process.env.PORT || 3000;

// function sendJson(res, data) {
//     res.writeHead(200, {
//         "Content-Type": "application/json; charset=utf-8"
//     });

//     res.end(JSON.stringify(data, null, 2));
// }

// const server = http.createServer(async (req, res) => {

//     if (req.url === "/" || req.url === "") {
//         return sendJson(res, {
//             status: "Vlogger Bluesky Auth Test Server Running",
//             test: "/test-bluesky-auth"
//         });
//     }

//     if (req.url.startsWith("/test-bluesky-auth")) {

//         const identifier = process.env.BSKY_IDENTIFIER;
//         const password = process.env.BSKY_PASSWORD;

//         if (!identifier || !password) {
//             return sendJson(res, {
//                 bluesky: "CONFIG_ERROR",
//                 message: "BSKY_IDENTIFIER or BSKY_PASSWORD missing"
//             });
//         }

//         try {

//             // =========================================
//             // STEP 1: LOGIN TO BLUESKY PDS
//             // =========================================

//             console.log("🔐 Logging into Bluesky...");

//             const loginResponse = await fetch(
//                 "https://bsky.social/xrpc/com.atproto.server.createSession",
//                 {
//                     method: "POST",

//                     headers: {
//                         "Content-Type": "application/json",
//                         "Accept": "application/json",
//                         "User-Agent": "Vlogger-Bluesky-Test/1.0"
//                     },

//                     body: JSON.stringify({
//                         identifier: identifier,
//                         password: password
//                     })
//                 }
//             );

//             const loginText = await loginResponse.text();

//             console.log(
//                 "Bluesky Login Status:",
//                 loginResponse.status
//             );

//             if (!loginResponse.ok) {

//                 return sendJson(res, {
//                     bluesky: "LOGIN_FAILED",
//                     loginStatus: loginResponse.status,
//                     contentType:
//                         loginResponse.headers.get("content-type"),
//                     response:
//                         loginText.substring(0, 1000)
//                 });
//             }

//             let session;

//             try {
//                 session = JSON.parse(loginText);
//             } catch (e) {
//                 return sendJson(res, {
//                     bluesky: "LOGIN_INVALID_JSON",
//                     loginStatus: loginResponse.status,
//                     response:
//                         loginText.substring(0, 1000)
//                 });
//             }

//             const accessJwt = session.accessJwt;

//             if (!accessJwt) {
//                 return sendJson(res, {
//                     bluesky: "NO_ACCESS_TOKEN",
//                     loginStatus: loginResponse.status
//                 });
//             }

//             console.log("✅ Bluesky login successful");

//             // =========================================
//             // STEP 2: AUTHENTICATED SEARCH
//             // IMPORTANT:
//             // Use user's PDS, NOT public.api.bsky.app
//             // =========================================

//             const searchUrl =
//                 "https://bsky.social/xrpc/" +
//                 "app.bsky.feed.searchPosts" +
//                 "?q=india" +
//                 "&sort=top" +
//                 "&limit=5";

//             console.log("🔎 Testing authenticated search...");

//             const searchResponse = await fetch(
//                 searchUrl,
//                 {
//                     method: "GET",

//                     headers: {
//                         "Authorization":
//                             `Bearer ${accessJwt}`,

//                         "Accept":
//                             "application/json",

//                         "User-Agent":
//                             "Vlogger-Bluesky-Test/1.0"
//                     }
//                 }
//             );

//             const searchText =
//                 await searchResponse.text();

//             console.log(
//                 "Authenticated Search Status:",
//                 searchResponse.status
//             );

//             if (!searchResponse.ok) {

//                 return sendJson(res, {
//                     bluesky: "AUTH_SEARCH_FAILED",

//                     loginStatus:
//                         loginResponse.status,

//                     loginWorking: true,

//                     searchStatus:
//                         searchResponse.status,

//                     contentType:
//                         searchResponse.headers.get(
//                             "content-type"
//                         ),

//                     response:
//                         searchText.substring(0, 1500)
//                 });
//             }

//             let searchData;

//             try {
//                 searchData =
//                     JSON.parse(searchText);
//             } catch (e) {

//                 return sendJson(res, {
//                     bluesky:
//                         "SEARCH_INVALID_JSON",

//                     searchStatus:
//                         searchResponse.status,

//                     response:
//                         searchText.substring(0, 1500)
//                 });
//             }

//             const posts =
//                 Array.isArray(searchData.posts)
//                     ? searchData.posts
//                     : [];

//             // =========================================
//             // SUCCESS
//             // =========================================

//             return sendJson(res, {

//                 bluesky:
//                     "AUTHENTICATED_WORKING",

//                 loginStatus:
//                     loginResponse.status,

//                 searchStatus:
//                     searchResponse.status,

//                 handle:
//                     session.handle || null,

//                 did:
//                     session.did || null,

//                 postsFound:
//                     posts.length,

//                 posts:
//                     posts.map(post => ({

//                         uri:
//                             post.uri || null,

//                         author:
//                             post.author?.handle || null,

//                         text:
//                             post.record?.text || null,

//                         hasEmbed:
//                             !!post.embed

//                     }))
//             });

//         } catch (error) {

//             console.error(
//                 "Bluesky Auth Test Exception:",
//                 error
//             );

//             return sendJson(res, {
//                 bluesky: "EXCEPTION",
//                 error: error.message
//             });
//         }
//     }

//     return sendJson(res, {
//         error: "Not Found",
//         available: [
//             "/test-bluesky-auth"
//         ]
//     });
// });

// server.listen(PORT, () => {

//     console.log(
//         `Vlogger Bluesky Auth Test running on port ${PORT}`
//     );

// });
