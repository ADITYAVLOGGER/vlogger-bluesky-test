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
    language,
    tags = []
) {
    const country =
        String(countryCode || "GLOBAL")
            .trim()
            .toUpperCase();

    /*
     * GLOBAL feed me fake country confidence
     * generate nahi karna.
     */
    if (
        !country ||
        country === "GLOBAL"
    ) {
        return 0;
    }


    const config =
        mastodonCountryWords(country);


    const safeTags =
        Array.isArray(tags)
            ? tags
            : [];


    const combined =
        (
            String(text || "") +
            " " +
            safeTags.join(" ")
        )
            .toLowerCase()
            .replace(/[_#-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();


    let score = 0;


    // ---------------------------------------------------------
    // STRONG LOCATION SIGNAL
    //
    // India:
    // india, delhi, mumbai, patna etc.
    // ---------------------------------------------------------

    for (
        const rawWord of
        (config.strong || [])
    ) {

        const word =
            String(rawWord || "")
                .toLowerCase()
                .trim();

        if (
            word &&
            combined.includes(word)
        ) {
            score += 35;
        }
    }


    // ---------------------------------------------------------
    // WEAK LOCATION SIGNAL
    //
    // Example: Indian
    // Alone country proof nahi hai.
    // ---------------------------------------------------------

    for (
        const rawWord of
        (config.weak || [])
    ) {

        const word =
            String(rawWord || "")
                .toLowerCase()
                .trim();

        if (
            word &&
            combined.includes(word)
        ) {
            score += 10;
        }
    }


    // ---------------------------------------------------------
    // LANGUAGE BONUS
    //
    // Language alone country proof nahi hai.
    // Hindi -> India useful signal,
    // English -> bahut countries me common.
    // ---------------------------------------------------------

    const lang =
        normalizeMastodonLanguage(
            language
        );


    const languages =
        Array.isArray(config.languages)
            ? config.languages
            : [];


    if (
        lang &&
        languages.includes(lang)
    ) {

        /*
         * English bahut global hai.
         * Isliye English ko small bonus.
         */
        if (lang === "en") {
            score += 5;
        } else {
            score += 15;
        }
    }


    // ---------------------------------------------------------
    // COUNTRY-SPECIFIC HASHTAG
    // ---------------------------------------------------------

    const normalizedTags =
        safeTags.map(
            rawTag =>
                String(rawTag || "")
                    .toLowerCase()
                    .replace(/^#/, "")
                    .replace(/[_\-\s]+/g, "")
                    .trim()
        );


    for (
        const rawWord of
        (config.strong || [])
    ) {

        const normalizedWord =
            String(rawWord || "")
                .toLowerCase()
                .replace(/[_\-\s#]+/g, "")
                .trim();


        if (
            normalizedWord &&
            normalizedTags.includes(
                normalizedWord
            )
        ) {
            /*
             * Explicit geographic hashtag
             * normal text mention se stronger signal.
             */
            score += 15;
        }
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
    const safeTags =
        Array.isArray(tags)
            ? tags
            : [];

    const combined =
        (
            String(text || "") +
            " " +
            safeTags.join(" ")
        )
            .toLowerCase()
            .replace(/[_#-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();


    if (!combined) {
        return 20;
    }


    // ---------------------------------------------------------
    // HARD NEGATIVES
    // Ye content Vlogger feed me nahi chahiye.
    // ---------------------------------------------------------

    const hardBlocks = [
        "gameplay",
        "walkthrough",
        "gaming stream",
        "game stream",
        "let's play",
        "lets play",

        "tutorial",
        "how to tutorial",
        "step by step tutorial",
        "course",
        "lecture",

        "podcast",
        "full podcast",

        "movie trailer",
        "official trailer",
        "full movie",
        "full episode",
        "episode trailer",

        "official music video",
        "official audio",
        "full album",
        "lyrics video",

        "unboxing",
        "product review",
        "tech review",

        "breaking news",
        "news update",
        "news report",

        "screen recording",
        "software demo",
        "app demo"
    ];


    if (
        hardBlocks.some(
            signal =>
                combined.includes(signal)
        )
    ) {
        return 0;
    }


    /*
     * Base score intentionally > 0.
     *
     * Mastodon posts bahut baar short caption ke
     * saath video upload karte hain.
     */
    let score = 20;


    // ---------------------------------------------------------
    // VERY STRONG VLOG SIGNALS
    // ---------------------------------------------------------

    const veryStrongSignals = [
        "daily vlog",
        "mini vlog",
        "travel vlog",
        "food vlog",
        "family vlog",
        "college vlog",
        "student vlog",
        "lifestyle vlog",

        "day in my life",
        "a day in my life",
        "week in my life",

        "travel diary",
        "travel journal",

        "my day",
        "my trip",
        "my journey",

        "morning routine",
        "evening routine",
        "daily routine",

        "college life",
        "campus life",
        "student life",

        "life in",
        "living in"
    ];


    for (const signal of veryStrongSignals) {

        if (
            combined.includes(signal)
        ) {
            score += 25;
        }
    }


    // ---------------------------------------------------------
    // STRONG PERSONAL / LIFESTYLE SIGNALS
    // ---------------------------------------------------------

    const strongSignals = [
        "vlog",
        "vlogging",

        "daily life",
        "everyday life",

        "travel",
        "travelling",
        "traveling",

        "trip",
        "vacation",
        "holiday",
        "journey",

        "road trip",
        "city walk",
        "walking around",

        "street food",
        "food trip",
        "food tour",

        "cafe hopping",
        "café hopping",

        "restaurant",
        "cafe",
        "café",

        "shopping",
        "shopping day",

        "weekend",
        "weekend trip",

        "family",
        "family time",

        "grwm",
        "get ready with me",

        "behind the scenes",

        "work day",
        "work life"
    ];


    for (const signal of strongSignals) {

        if (
            combined.includes(signal)
        ) {
            score += 15;
        }
    }


    // ---------------------------------------------------------
    // PERSONAL-FIRST-PERSON SIGNALS
    //
    // Vlog me literal "vlog" hona compulsory nahi.
    // ---------------------------------------------------------

    const personalSignals = [
        "my life",
        "my morning",
        "my evening",
        "my weekend",
        "my vacation",
        "my holiday",
        "my family",
        "my college",
        "my university",
        "my campus",
        "my city",
        "my hometown",

        "we went",
        "we visited",
        "we travelled",
        "we traveled",

        "i went",
        "i visited",
        "i travelled",
        "i traveled",

        "today i",
        "today we"
    ];


    for (const signal of personalSignals) {

        if (
            combined.includes(signal)
        ) {
            score += 12;
        }
    }


    // ---------------------------------------------------------
    // SUPPORTING SIGNALS
    // Alone ye vlog prove nahi karte.
    // ---------------------------------------------------------

    const supportingSignals = [
        "today",
        "weekend",
        "morning",
        "evening",

        "breakfast",
        "lunch",
        "dinner",

        "market",
        "street",
        "city",
        "beach",
        "mountain",

        "hotel",
        "hostel",

        "train",
        "flight",
        "airport",

        "festival",
        "celebration"
    ];


    for (const signal of supportingSignals) {

        if (
            combined.includes(signal)
        ) {
            score += 5;
        }
    }


    // ---------------------------------------------------------
    // HASHTAG BONUS
    // ---------------------------------------------------------

    const usefulTags = [
        "vlog",
        "dailyvlog",
        "minivlog",

        "travel",
        "travelvlog",
        "travelphotography",

        "food",
        "foodie",
        "streetfood",

        "dailylife",
        "dayinmylife",
        "lifestyle",

        "roadtrip",
        "vacation",
        "holiday",

        "citylife",
        "college",
        "studentlife"
    ];


    for (const rawTag of safeTags) {

        const tag =
            String(rawTag || "")
                .toLowerCase()
                .replace(/^#/, "")
                .replace(/[_\-\s]+/g, "")
                .trim();

        if (
            usefulTags.includes(tag)
        ) {
            score += 8;
        }
    }


    return Math.min(
        100,
        score
    );
}

const MASTODON_HASHTAGS = {

    IN: [
        "india",
        "travelindia",
        "indianfood",
        "delhi",
        "mumbai",
        "bangalore",
        "bengaluru",
        "kolkata",
        "chennai",
        "hyderabad",
        "kerala",
        "goa",
        "travel",
        "food",
        "streetfood",
        "dailylife",
        "dayinmylife",
        "lifestyle"
    ],

    JP: [
        "japan",
        "tokyo",
        "osaka",
        "kyoto",
        "japantravel",
        "japanesefood",
        "travel",
        "food",
        "dailylife",
        "lifestyle"
    ],

    AE: [
        "uae",
        "dubai",
        "abudhabi",
        "dubailife",
        "dubaitravel",
        "travel",
        "food",
        "dailylife",
        "lifestyle"
    ],

    DE: [
        "germany",
        "deutschland",
        "berlin",
        "munich",
        "hamburg",
        "travel",
        "food",
        "dailylife",
        "lifestyle"
    ],

    BR: [
        "brazil",
        "brasil",
        "saopaulo",
        "riodejaneiro",
        "viagem",
        "comida",
        "travel",
        "food",
        "lifestyle"
    ],

    DEFAULT: [
        "travel",
        "food",
        "streetfood",
        "dailylife",
        "dayinmylife",
        "lifestyle",
        "citylife",
        "college",
        "vacation",
        "roadtrip"
    ]
};

async function fetchMastodonHashtag(
    host,
    hashtag
) {
    const controller = new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            MASTODON_TIMEOUT_MS
        );

    try {
        const cleanTag =
            String(hashtag || "")
                .trim()
                .replace(/^#/, "");

        if (!cleanTag) {
            return {
                hashtag,
                statuses: [],
                authRequired: false
            };
        }

        const url =
            `https://${host}` +
            `/api/v1/timelines/tag/` +
            `${encodeURIComponent(cleanTag)}` +
            `?only_media=true&limit=40`;

        const headers = {
            "Accept": "application/json",
            "User-Agent": "Vlogger/1.0"
        };

        // IMPORTANT:
        // mastodon.social ka token kisi dusre
        // Mastodon server ko mat bhejna.
        if (
            host === "mastodon.social" &&
            MASTODON_ACCESS_TOKEN
        ) {
            headers["Authorization"] =
                `Bearer ${MASTODON_ACCESS_TOKEN}`;
        }

        const response =
            await fetch(
                url,
                {
                    method: "GET",
                    headers,
                    signal: controller.signal
                }
            );

        if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 422
        ) {
            console.log(
                `🐘 MASTODON AUTH | host=${host}` +
                ` | tag=${cleanTag}` +
                ` | code=${response.status}`
            );

            return {
                hashtag: cleanTag,
                statuses: [],
                authRequired: true
            };
        }

        if (!response.ok) {
            const body =
                await response
                    .text()
                    .catch(() => "");

            console.log(
                `🐘 MASTODON HTTP ERROR` +
                ` | host=${host}` +
                ` | tag=${cleanTag}` +
                ` | code=${response.status}` +
                ` | body=${body.slice(0, 150)}`
            );

            return {
                hashtag: cleanTag,
                statuses: [],
                authRequired: false
            };
        }

        const data = await response.json();

        const statuses =
            Array.isArray(data)
                ? data
                : [];

        console.log(
            `🐘 MASTODON TAG` +
            ` | #${cleanTag}` +
            ` | statuses=${statuses.length}`
        );

        return {
            hashtag: cleanTag,
            statuses,
            authRequired: false
        };

    } catch (error) {

        console.log(
            `🐘 MASTODON TAG FAILED` +
            ` | host=${host}` +
            ` | tag=${hashtag}` +
            ` | error=${error.message}`
        );

        return {
            hashtag,
            statuses: [],
            authRequired: false
        };

    } finally {
        clearTimeout(timeout);
    }
}

function getMastodonHashtags(countryCode) {

    const country =
        String(countryCode || "GLOBAL")
            .trim()
            .toUpperCase();

    const local =
        MASTODON_HASHTAGS[country] || [];

    const global =
        MASTODON_HASHTAGS.DEFAULT;

    // Country-specific tags ko priority.
    // Har API request me bahut saare calls nahi karenge.
    const localSelected =
        local.slice(0, 5);

    const globalSelected =
        global.slice(0, 3);

    return [
        ...new Set([
            ...localSelected,
            ...globalSelected
        ])
    ];
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
        country,
        combinedText,
        status?.language,
        tags
    );
        // calculateMastodonCountryScore(
        //     countryCode,
        //     countryText,
        //     language
        // );


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
        Math.min(
            Math.max(
                Number(requestedLimit) || 10,
                1
            ),
            30
        );

    const host =
        "mastodon.social";

    const hashtags =
        getMastodonHashtags(country);

    console.log(
        `🐘 MASTODON START` +
        ` | country=${country}` +
        ` | tags=${hashtags.join(",")}`
    );

    /*
     * Sab hashtag requests parallel.
     */
    const responses =
        await Promise.all(
            hashtags.map(
                hashtag =>
                    fetchMastodonHashtag(
                        host,
                        hashtag
                    )
            )
        );

    let authRestrictedInstances = 0;

    for (const result of responses) {
        if (result.authRequired) {
            authRestrictedInstances++;
        }
    }

    /*
     * Sab statuses combine.
     */
    const allStatuses =
        responses.flatMap(
            result =>
                Array.isArray(result.statuses)
                    ? result.statuses
                    : []
        );

    console.log(
        `🐘 MASTODON RAW` +
        ` | statuses=${allStatuses.length}`
    );

    /*
     * Same post multiple hashtags me mil sakta hai.
     * ID se dedupe.
     */
    const uniqueMap =
        new Map();

    for (const status of allStatuses) {

        if (!status?.id) {
            continue;
        }

        /*
         * Remote status IDs theoretically host context me
         * local representation ho sakte hain.
         */
        const key =
            status.uri ||
            status.url ||
            status.id;

        if (!uniqueMap.has(key)) {
            uniqueMap.set(
                key,
                status
            );
        }
    }

    const uniqueStatuses =
        [...uniqueMap.values()];

    console.log(
        `🐘 MASTODON UNIQUE` +
        ` | statuses=${uniqueStatuses.length}`
    );

    const candidates = [];

    let videoStatuses = 0;
    let vlogPassed = 0;

    for (const status of uniqueStatuses) {

        try {

            /*
             * Sensitive posts reject.
             */
            if (status?.sensitive === true) {
                continue;
            }

            /*
             * Bots reject.
             */
            if (status?.account?.bot === true) {
                continue;
            }

            const attachments =
                Array.isArray(
                    status?.media_attachments
                )
                    ? status.media_attachments
                    : [];

            /*
             * Mastodon attachment type must actually be video.
             *
             * "gifv" ko intentionally abhi include nahi kar rahe,
             * because Vlogger me proper vlog video chahiye.
             */
            const video =
                attachments.find(
                    media =>
                        media?.type === "video" &&
                        (
                            media?.url ||
                            media?.remote_url
                        )
                );

            if (!video) {
                continue;
            }

            videoStatuses++;

            const description =
                stripHtml(
                    status?.content || ""
                );

            const mediaDescription =
                cleanText(
                    video?.description
                );

            const tags =
                Array.isArray(status?.tags)
                    ? status.tags
                        .map(tag =>
                            cleanText(tag?.name)
                        )
                        .filter(Boolean)
                    : [];

            const accountNote =
                stripHtml(
                    status?.account?.note || ""
                );

            const combinedText =
                [
                    description,
                    mediaDescription,
                    accountNote,
                    tags.join(" ")
                ]
                    .filter(Boolean)
                    .join(" ")
                    .trim();

            /*
             * Existing classifier use karo.
             *
             * Agar tumhare function ka exact naam/arguments
             * calculateMastodonVlogScore(text) hi hai,
             * ye directly chalega.
             */
            const vlogScore =
    calculateMastodonVlogScore(
        combinedText,
        tags
    );

            /*
             * High-recall threshold.
             * Literal "vlog" required nahi.
             */
            if (vlogScore < 35) {
                continue;
            }

            vlogPassed++;

            const detectedLanguage =
                normalizeMastodonLanguage(
                    status?.language
                );

            /*
             * Existing country scorer.
             */
            const countryConfidence =
    calculateMastodonCountryScore(
        country,
        combinedText,
        status?.language,
        tags
    );

            const likes =
                Number(
                    status?.favourites_count || 0
                );

            const comments =
                Number(
                    status?.replies_count || 0
                );

            const shares =
                Number(
                    status?.reblogs_count || 0
                );

            /*
             * Same basic engagement formula.
             */
            const engagementScore =
                likes +
                (comments * 2) +
                (shares * 3);

            const creatorName =
                cleanText(
                    status?.account?.display_name
                ) ||
                cleanText(
                    status?.account?.username
                ) ||
                "Mastodon";

            const creatorId =
                cleanText(
                    status?.account?.acct
                ) ||
                cleanText(
                    status?.account?.id
                );

            const videoUrl =
                cleanText(
                    video?.url
                ) ||
                cleanText(
                    video?.remote_url
                );

            if (!videoUrl) {
                continue;
            }

            const thumbnailUrl =
                cleanText(
                    video?.preview_url
                ) || null;

            candidates.push({

                uniqueId:
                    `mastodon_${status.id}`,

                provider:
                    "mastodon",

                videoUrl,

                thumbnailUrl,

                originalPostUrl:
                    cleanText(status?.url) ||
                    cleanText(status?.uri) ||
                    null,

                title:
                    description
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 180),

                description:
                    combinedText
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 1000),

                creatorId,

                creatorName,

                creatorAvatar:
                    cleanText(
                        status?.account?.avatar
                    ) || null,

                language:
                    detectedLanguage,

                detectedCountry:
                    countryConfidence >= 60
                        ? country
                        : null,

                views: 0,

                likes,

                comments,

                shares,

                publishedAt:
                    status?.created_at
                        ? Date.parse(
                            status.created_at
                        ) || 0
                        : 0,

                countryConfidence,

                vlogScore,

                engagementScore
            });

        } catch (error) {

            console.log(
                `🐘 MASTODON STATUS SKIP` +
                ` | id=${status?.id || "unknown"}` +
                ` | error=${error.message}`
            );
        }
    }

    /*
     * Country relevance first,
     * then vlog quality,
     * then engagement,
     * then freshness.
     */
    candidates.sort(
        (a, b) => {

            if (
                b.countryConfidence !==
                a.countryConfidence
            ) {
                return (
                    b.countryConfidence -
                    a.countryConfidence
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

            if (
                b.engagementScore !==
                    a.engagementScore
            ) {
                return (
                    b.engagementScore -
                    a.engagementScore
                );
            }

            return (
                b.publishedAt -
                a.publishedAt
            );
        }
    );

    /*
     * Country tiers.
     */
    const strongCountry =
        candidates.filter(
            item =>
                item.countryConfidence >= 70
        );

    const possibleCountry =
        candidates.filter(
            item =>
                item.countryConfidence >= 35 &&
                item.countryConfidence < 70
        );

    const weakCountry =
        candidates.filter(
            item =>
                item.countryConfidence < 35
        );

    /*
     * Strong local first.
     * Agar local kam mila to possible/global se fill.
     *
     * IMPORTANT:
     * target complete na hone par [] nahi.
     * Jitne mile utne return.
     */
    const videos =
        [
            ...strongCountry,
            ...possibleCountry,
            ...weakCountry
        ]
            .slice(
                0,
                limit
            );

    console.log(
        `🐘 MASTODON DONE` +
        ` | country=${country}` +
        ` | raw=${allStatuses.length}` +
        ` | unique=${uniqueStatuses.length}` +
        ` | videos=${videoStatuses}` +
        ` | vlogPassed=${vlogPassed}` +
        ` | candidates=${candidates.length}` +
        ` | returned=${videos.length}`
    );

    return {

        videos,

        debug: {
            instancesAttempted: 1,

            hashtagsAttempted:
                hashtags.length,

            hashtags:
                hashtags,

            authRestrictedInstances,

            statusesReceived:
                allStatuses.length,

            uniqueStatuses:
                uniqueStatuses.length,

            videoStatuses,

            vlogPassed,

            candidates:
                candidates.length
        },

        tiers: {
            strongCountry:
                strongCountry.length,

            possibleCountry:
                possibleCountry.length,

            weakCountry:
                weakCountry.length
        }
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
