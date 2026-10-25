const http = require("http");

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIG
// ============================================================

const MASTODON_ACCESS_TOKEN =
    process.env.MASTODON_ACCESS_TOKEN || "";


const BSKY_PUBLIC_API =
    "https://api.bsky.app";

const MAX_OUTPUT_LIMIT = 20;
const SEARCH_LIMIT = 100;

const MASTODON_TIMEOUT_MS = 8000;

// ============================================================
// MASTODON COUNTRY CONFIG
// ============================================================

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
// BLUESKY SESSION CACHE
// ============================================================


// ============================================================
// BASIC HELPERS
// ============================================================

function sendJson(
    res,
    statusCode,
    data
) {

    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8",

            "Cache-Control":
                "no-store",

            "Access-Control-Allow-Origin":
                "*"
        }
    );

    res.end(
        JSON.stringify(
            data,
            null,
            2
        )
    );
}


function cleanText(value) {

    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value.trim();
}


function safeNumber(value) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}


function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


// ============================================================
// BLUESKY LOGIN
// ============================================================



// ============================================================
// GET CACHED BLUESKY SESSION
// ============================================================



// ============================================================
// AUTHENTICATED BLUESKY REQUEST
// ============================================================


async function blueskyGet(
    path,
    params = {}
) {

    const searchParams =
        new URLSearchParams();


    for (
        const [key, value]
        of Object.entries(params)
    ) {

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


    const query =
        searchParams.toString();


    const url =
        `${BSKY_PUBLIC_API}/xrpc/${path}` +
        (
            query
                ? `?${query}`
                : ""
        );


    console.log(
        `🌐 BLUESKY PUBLIC REQUEST` +
        ` | path=${path}`
    );


    return fetch(
        url,
        {
            method: "GET",

            headers: {

                "Accept":
                    "application/json",

                "User-Agent":
                    "Vlogger/1.0"
            }
        }
    );
}



function encodeBlueskyCursor(cursorMap) {

    try {

        const json =
            JSON.stringify(
                cursorMap || {}
            );

        return Buffer
            .from(
                json,
                "utf8"
            )
            .toString(
                "base64url"
            );

    } catch (error) {

        console.log(
            "❌ BLUESKY CURSOR ENCODE FAILED",
            error?.message || error
        );

        return null;
    }
}


function decodeBlueskyCursor(cursor) {

    if (!cursor) {
        return {};
    }

    try {

        const json =
            Buffer
                .from(
                    String(cursor),
                    "base64url"
                )
                .toString(
                    "utf8"
                );

        const parsed =
            JSON.parse(json);

        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {
            return {};
        }

        return parsed;

    } catch (error) {

        console.log(
            "⚠️ INVALID BLUESKY CURSOR - STARTING FRESH"
        );

        return {};
    }
}


// ============================================================
// BLUESKY SEARCH
// ============================================================

async function searchPosts(
    query,
    until = null
) {

    const params = {
        q: query,
        sort: "latest",
        limit: SEARCH_LIMIT
    };


    /*
     * IMPORTANT:
     *
     * Bluesky native cursor use NAHI karna.
     *
     * Public API first page works,
     * lekin native cursor requests 403 de rahi hain.
     *
     * Next page ke liye previous search ke
     * oldest post se pehle search karenge.
     */
    if (until) {
        params.until = String(until);
    }


    console.log(
        `🔎 BLUESKY SEARCH` +
        ` | query=${query}` +
        ` | until=${until || "LATEST"}`
    );


    try {

        const response =
            await blueskyGet(
                "app.bsky.feed.searchPosts",
                params
            );


        const responseText =
            await response.text();


        // ====================================================
        // HTTP ERROR
        // ====================================================

        if (!response.ok) {

            console.log(
                `❌ BLUESKY SEARCH HTTP ERROR` +
                ` | query=${query}` +
                ` | status=${response.status}` +
                ` | until=${until || "LATEST"}` +
                ` | body=${responseText.slice(0, 300)}`
            );


            return {
                query,
                status: response.status,
                posts: [],
                nextUntil: until || null,
                hasMore: false
            };
        }


        // ====================================================
        // JSON
        // ====================================================

        let data;

        try {

            data =
                JSON.parse(
                    responseText
                );

        } catch (error) {

            console.log(
                `❌ BLUESKY INVALID JSON` +
                ` | query=${query}` +
                ` | body=${responseText.slice(0, 300)}`
            );


            return {
                query,
                status: response.status,
                posts: [],
                nextUntil: until || null,
                hasMore: false
            };
        }


        const posts =
            Array.isArray(data?.posts)
                ? data.posts
                : [];


        // ====================================================
        // FIND OLDEST POST
        // ====================================================

        let oldestTimestamp = null;


        for (const post of posts) {

            /*
             * Prefer indexedAt because search ordering
             * is based on indexed/searchable records.
             *
             * Fallback to record.createdAt.
             */

            const rawDate =
                cleanText(post?.indexedAt) ||
                cleanText(post?.record?.createdAt);


            if (!rawDate) {
                continue;
            }


            const time =
                Date.parse(rawDate);


            if (!Number.isFinite(time)) {
                continue;
            }


            if (
                oldestTimestamp === null ||
                time < oldestTimestamp
            ) {

                oldestTimestamp = time;
            }
        }


        /*
         * Move boundary slightly backwards so the next
         * request doesn't sit on exactly the same timestamp.
         */
        const nextUntil =
            oldestTimestamp !== null
                ? new Date(
                    oldestTimestamp - 1
                ).toISOString()
                : null;


        /*
         * SEARCH_LIMIT results aaye hain to older results
         * likely available hain.
         *
         * Kam results aaye => is query ko exhausted
         * consider kar sakte hain.
         */
    

const currentUntilMs =
    until
        ? Date.parse(until)
        : null;

const nextUntilMs =
    nextUntil
        ? Date.parse(nextUntil)
        : null;


/*
 * Continue only when time boundary actually moves
 * backwards.
 *
 * Isse same result/timestamp par query forever
 * loop nahi karegi.
 */
const boundaryMovedBackward =
    until === null ||
    (
        Number.isFinite(currentUntilMs) &&
        Number.isFinite(nextUntilMs) &&
        nextUntilMs < currentUntilMs
    );


const hasMore =
    posts.length > 0 &&
    nextUntil !== null &&
    boundaryMovedBackward;

        console.log(
            `✅ BLUESKY SEARCH` +
            ` | query=${query}` +
            ` | status=${response.status}` +
            ` | posts=${posts.length}` +
            ` | nextUntil=${nextUntil || "NONE"}` +
            ` | hasMore=${hasMore}`
        );


        return {
            query,
            status: response.status,
            posts,
            nextUntil,
            hasMore
        };


    } catch (error) {

        console.log(
            `❌ BLUESKY SEARCH FAILED` +
            ` | query=${query}` +
            ` | error=${error?.message || error}`
        );


        return {
            query,
            status: 0,
            posts: [],
            nextUntil: until || null,
            hasMore: false
        };
    }
}

// ============================================================
// BLUESKY VIDEO FEED DISCOVERY
// ============================================================

const BLUESKY_VIDEO_FEED =
    "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";

async function fetchBlueskyVideoFeed(
    cursor = null,
    limit = 50
) {

    const params = {

        feed:
            BLUESKY_VIDEO_FEED,

        limit:
            Math.min(
                Math.max(
                    Number(limit) || 50,
                    1
                ),
                100
            )
    };


    if (cursor) {

        params.cursor =
            String(cursor);
    }


    console.log(
        `🎥 BLUESKY VIDEO FEED REQUEST` +
        ` | cursor=${cursor ? "CONTINUE" : "FIRST"}` +
        ` | limit=${params.limit}`
    );


    try {

        const response =
            await blueskyGet(
                "app.bsky.feed.getFeed",
                params
            );


        const responseText =
            await response.text();


        if (!response.ok) {

            console.log(
                `❌ BLUESKY VIDEO FEED HTTP ERROR` +
                ` | status=${response.status}` +
                ` | body=${responseText.slice(0, 300)}`
            );


            return {

                status:
                    response.status,

                posts: [],

                cursor:
                    null,

                hasMore:
                    false
            };
        }


        let data;


        try {

            data =
                JSON.parse(
                    responseText
                );

        } catch (error) {

            console.log(
                `❌ BLUESKY VIDEO FEED INVALID JSON` +
                ` | body=${responseText.slice(0, 300)}`
            );


            return {

                status:
                    response.status,

                posts: [],

                cursor:
                    null,

                hasMore:
                    false
            };
        }


        const feed =
            Array.isArray(
                data?.feed
            )
                ? data.feed
                : [];


        const posts =
            feed
                .map(
                    item =>
                        item?.post
                )
                .filter(Boolean);


        const nextCursor =
            cleanText(
                data?.cursor
            ) || null;


        console.log(
            `✅ BLUESKY VIDEO FEED` +
            ` | status=${response.status}` +
            ` | posts=${posts.length}` +
            ` | nextCursor=${nextCursor ? "YES" : "NONE"}`
        );


        return {

            status:
                response.status,

            posts,

            cursor:
                nextCursor,

            hasMore:
                Boolean(
                    nextCursor
                )
        };


    } catch (error) {

        console.log(
            `❌ BLUESKY VIDEO FEED FAILED` +
            ` | error=${error?.message || error}`
        );


        return {

            status: 0,

            posts: [],

            cursor: null,

            hasMore: false
        };
    }
}

// ============================================================
// COUNTRY SEARCH QUERIES
// ============================================================




function getCountryQueries(
    countryCode
) {

    const country =
        cleanText(countryCode)
            .toUpperCase();

    switch (country) {

        // ====================================================
        // INDIA
        // ====================================================

        case "IN":

           return [

    // ========================================================
    // HIGH INTENT — explicit vlog
    // ========================================================

    "india vlog",
    "indian vlog",
    "hindi vlog",

    // ========================================================
    // PERSONAL / DAILY LIFE
    // ========================================================

    "day in my life india",
    "daily life india",
    "college life india",

    // ========================================================
    // LOCAL CITY DISCOVERY
    // ========================================================

    "delhi vlog",
    "mumbai vlog",
    "bangalore vlog",

    // ========================================================
    // LOCAL LIFESTYLE
    // ========================================================

    "street food india",
    "travel india",

    // ========================================================
    // NATIVE LANGUAGE DISCOVERY
    // ========================================================

    "भारत vlog"
];


        // ====================================================
        // JAPAN
        // ====================================================

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


        // ====================================================
        // UAE
        // ====================================================

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


        // ====================================================
        // SOUTH KOREA
        // ====================================================

        case "KR":

            return [
                "korea vlog",
                "korean vlog",
                "seoul vlog",
                "korea daily life",
                "life in korea"
            ];


        // ====================================================
        // UNITED STATES
        // ====================================================

        case "US":

            return [
                "usa vlog",
                "american vlog",
                "daily vlog",
                "day in my life",
                "life in america",
                "usa travel"
            ];


        // ====================================================
        // UNITED KINGDOM
        // ====================================================

        case "GB":

            return [
                "uk vlog",
                "british vlog",
                "london vlog",
                "daily life uk",
                "life in london"
            ];


        // ====================================================
        // GERMANY
        // ====================================================

        case "DE":

            return [
                "germany vlog",
                "german vlog",
                "berlin vlog",
                "daily life germany",
                "leben in deutschland"
            ];


        // ====================================================
        // FRANCE
        // ====================================================

        case "FR":

            return [
                "france vlog",
                "french vlog",
                "paris vlog",
                "daily life france"
            ];


        // ====================================================
        // BRAZIL
        // ====================================================

        case "BR":

            return [
                "brazil vlog",
                "brasil vlog",
                "daily life brazil",
                "vida no brasil"
            ];


        // ====================================================
        // GENERIC / OTHER COUNTRIES
        // ====================================================

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
// BLUESKY VIDEO EXTRACTION
// ============================================================

function extractVideo(post) {

    const embed =
        post?.embed;

    if (!embed) {
        return null;
    }

    /*
     * Bluesky video view can expose
     * the playable HLS playlist directly.
     */

    const playlist =
        cleanText(
            embed?.playlist
        ) ||
        cleanText(
            embed?.video?.playlist
        );

    if (!playlist) {
        return null;
    }

    const thumbnail =
        cleanText(
            embed?.thumbnail
        ) ||
        cleanText(
            embed?.video?.thumbnail
        ) ||
        null;

    return {
        playlist,
        thumbnail
    };
}


// ============================================================
// BLUESKY POST TEXT
// ============================================================

function getPostText(post) {

    return cleanText(
        post?.record?.text
    );
}


// ============================================================
// BLUESKY HARD NON-VLOG FILTER
// ============================================================

function containsBlockedContent(text) {

    const value =
        String(text || "")
            .toLowerCase()
            .replace(/[_#./\\|]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();


    // ========================================================
    // NORMAL BLOCKED PHRASES
    // ========================================================

    const blockedPhrases = [

        // ----------------------------------------------------
        // NEWS / POLITICS
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // GAMING
        // ----------------------------------------------------

        "gameplay",
        "walkthrough",
        "gaming stream",
        "let's play",
        "lets play",

        // ----------------------------------------------------
        // TUTORIALS / COURSES
        // ----------------------------------------------------

        "tutorial",
        "how to ",
        "course ",
        "lesson ",
        "lecture ",

        // ----------------------------------------------------
        // REVIEWS
        // ----------------------------------------------------

        "unboxing",
        "product review",
        "tech review",

        // ----------------------------------------------------
        // MOVIES / COPIED ENTERTAINMENT
        // ----------------------------------------------------

        "movie trailer",
        "official trailer",
        "full movie",
        "episode ",
        "season ",
        "music video",
        "official music",

        // ----------------------------------------------------
        // PODCAST / INTERVIEW
        // ----------------------------------------------------

        "podcast",
        "full interview",

        // ----------------------------------------------------
        // SCREEN / DEMO
        // ----------------------------------------------------

        "screen recording",
        "software demo",
        "app demo",

        // ----------------------------------------------------
// EXTERNAL VIDEO / REPOST PROMOTION
// ----------------------------------------------------

"full video on youtube",
"watch full video on youtube",
"watch on youtube",
"full video on yt",
"watch full video on yt",
"full video on youtu.be",

"subscribe to youtube",
"subscribe on youtube",
"subscribe to my youtube",

"youtube channel",
"youtube.com/watch",
"youtu.be/",

"x.com/",
"twitter.com/",

        // ----------------------------------------------------
        // EXPLICIT / ADULT CONTENT
        // ----------------------------------------------------

        "porn",
        "porno",
        "pornography",
        "nsfw",
        "nude",
        "nudes",
        "nudity",
        "xxx",
        "onlyfans",

        "incest",
        "momcest",

        "mother son",
        "mother-son",

        "father daughter",
        "father-daughter",

        "brother sister",
        "brother-sister",

        "stepmom",
        "stepson",
        "stepdaughter",
        "stepfather",
        "stepbrother",
        "stepsister",

        "big boobs",
        "bigboobs",

        "fetish",
        "bdsm",
        "horny",
        "erotic",
        "erotica"
    ];


    if (
        blockedPhrases.some(
            phrase =>
                value.includes(phrase)
        )
    ) {

        return true;
    }


    // ========================================================
    // WORD-BOUNDARY SENSITIVE TERMS
    //
    // "sex" ko includes() se check nahi karenge,
    // warna "Sussex" jaisi innocent string block ho sakti hai.
    // ========================================================

    const blockedWordPatterns = [

        /\bsex\b/i,
        /\bsexual\b/i,
        /\bsexy\b/i,

        /\bboobs?\b/i,
        /\bbreasts?\b/i,

        /\bnaked\b/i,

        /\bexplicit\b/i
    ];


    if (
        blockedWordPatterns.some(
            pattern =>
                pattern.test(value)
        )
    ) {

        return true;
    }


    return false;
}

function containsBlueskyJunk(
    post
) {

    const text =
        getPostText(post);

    const value =
        String(text || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();


    const author =
        post?.author || {};


    const displayName =
        cleanText(
            author?.displayName
        )
            .toLowerCase();


    const handle =
        cleanText(
            author?.handle
        )
            .toLowerCase();


    // ========================================================
    // 1. OBVIOUS BOT / MIRROR ACCOUNT
    // ========================================================

    const obviousBotNames = [
        "x bot",
        "twitter bot",
        "twitter mirror",
        "x mirror"
    ];


    if (
        obviousBotNames.some(
            name =>
                displayName === name ||
                handle === name
        )
    ) {

        return true;
    }


    // ========================================================
    // 2. X / TWITTER STATUS MIRROR
    // ========================================================

    if (
        /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/\s]+\/status\/\d+/i
            .test(value)
    ) {

        return true;
    }


    // ========================================================
    // 3. MIRROR-STYLE GENERATED HASHTAGS
    //
    // Example:
    // #x-marc_louvion
    // ========================================================

    if (
        /(?:^|\s)#x-[a-z0-9_.-]+/i
            .test(value)
    ) {

        return true;
    }


    // ========================================================
    // 4. EXTERNAL FULL-VIDEO PROMOTION
    // ========================================================

    const externalPromoPatterns = [

        /\bfull\s+video\s+on\s+(?:youtube|yt)\b/i,

        /\bwatch\s+(?:the\s+)?full\s+video\s+on\s+(?:youtube|yt)\b/i,

        /\bwatch\s+on\s+youtube\b/i,

        /\bsubscribe\s+(?:to|on)\s+(?:my\s+)?youtube\b/i
    ];


    if (
        externalPromoPatterns.some(
            pattern =>
                pattern.test(value)
        )
    ) {

        return true;
    }


    // ========================================================
    // 5. LINK-DOMINATED REPOST
    //
    // IMPORTANT:
    // Normal creator with one link should NOT be blocked.
    // Only very low-original-text posts are blocked.
    // ========================================================

    const urls =
        value.match(
            /https?:\/\/\S+/gi
        ) || [];


    if (
        urls.length > 0
    ) {

        const withoutUrls =
            value
                .replace(
                    /https?:\/\/\S+/gi,
                    " "
                )
                .replace(
                    /@[a-z0-9_.-]+/gi,
                    " "
                )
                .replace(
                    /#[a-z0-9_.-]+/gi,
                    " "
                )
                .replace(
                    /[^\p{L}\p{N}\s]/gu,
                    " "
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        /*
         * Link + almost no original text =
         * likely mirror/repost/promo.
         *
         * Genuine vlog captions with meaningful text survive.
         */
        if (
            withoutUrls.length < 15
        ) {

            return true;
        }
    }


    return false;
}


// ============================================================
// BLUESKY VLOG SCORE
// ============================================================

function calculateVlogScore(post) {

    const text =
        normalizeSignalText(
            getPostText(post)
        );

    if (!text) {
        return 0;
    }


    // ========================================================
    // HARD BLOCK
    // ========================================================

    if (
        containsBlockedContent(text) ||
        containsBlueskyJunk(post)
    ) {
        return 0;
    }


    let score = 10;


    // ========================================================
    // 1. STRONG VLOG SIGNALS
    // ========================================================

    const strongSignals = [

        "vlog",
        "vlogging",
        "daily vlog",
        "mini vlog",
        "travel vlog",
        "food vlog",
        "weekend vlog",

        // Hindi / Indian discovery
        "व्लॉग",
        "मिनी व्लॉग"
    ];


    // ========================================================
    // 2. PERSONAL LIFE / DAILY-LIFE SIGNALS
    // ========================================================

    const lifestyleSignals = [

        "day in my life",
        "daily life",
        "my day",

        "morning routine",
        "evening routine",
        "daily routine",

        "college life",
        "student life",
        "school life",
        "hostel life",
        "work life",

        "life in ",
        "living in ",

        "grwm",
        "get ready with me",

        "weekend in",
        "weekend trip",
        "road trip",

        "travel diary",
        "travel diaries",
        "travel day",

        "food diary",
        "what i eat",
        "what i ate",

        "exploring ",
        "explore with me",

        // Hindi personal/lifestyle signals
        "मेरी जिंदगी",
        "मेरी ज़िंदगी",
        "मेरी दिनचर्या",
        "मेरा दिन",
        "आज का दिन",
        "मेरी यात्रा",
        "मेरा सफर"
    ];


    // ========================================================
    // 3. FIRST-PERSON / CREATOR SIGNALS
    // ========================================================

    const personalSignals = [

        "my ",
        "today i",
        "today we",

        "i went",
        "we went",

        "i visited",
        "we visited",

        "i explored",
        "we explored",

        "i tried",
        "we tried",

        "come with me",
        "join me",

        "our trip",
        "my trip",

        "our day",
        "my life",
        "our journey"
    ];


    // ========================================================
    // 4. WEAK TOPIC SIGNALS
    //
    // IMPORTANT:
    // These do NOT prove that something is a vlog.
    // ========================================================

    const weakLifestyleSignals = [

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

        "college",
        "campus",
        "hostel",

        "food",
        "restaurant"
    ];


    // ========================================================
    // 5. PROMOTIONAL / GUIDE / COMMERCIAL SIGNALS
    // ========================================================

    const promotionalSignals = [

        "visit here",
        "visit our",
        "visit us",

        "read more",
        "read our",
        "full guide",
        "our guide",

        "click here",
        "learn more",

        "book now",
        "book here",
        "reserve now",

        "shop now",
        "buy now",
        "order now",

        "available now",
        "download now",

        "best prices",
        "affordable prices",

        "contact us",
        "call us",

        "official website",
        "our website",

        "first timer's guide",
        "first timers guide",

        "tips and tricks",
        "top 10",
        "top 5"
    ];


    // ========================================================
    // 6. COUNT SIGNALS
    // ========================================================

    let strongCount = 0;
    let lifestyleCount = 0;
    let personalCount = 0;
    let weakCount = 0;
    let promotionalCount = 0;


    for (
        const signal
        of strongSignals
    ) {

        if (
            text.includes(signal)
        ) {
            strongCount++;
        }
    }


    for (
        const signal
        of lifestyleSignals
    ) {

        if (
            text.includes(signal)
        ) {
            lifestyleCount++;
        }
    }


    for (
        const signal
        of personalSignals
    ) {

        if (
            text.includes(signal)
        ) {
            personalCount++;
        }
    }


    for (
        const signal
        of weakLifestyleSignals
    ) {

        if (
            text.includes(signal)
        ) {
            weakCount++;
        }
    }


    for (
        const signal
        of promotionalSignals
    ) {

        if (
            text.includes(signal)
        ) {
            promotionalCount++;
        }
    }


    // ========================================================
    // 7. POSITIVE SCORING
    // ========================================================

    if (
        strongCount > 0
    ) {

        score += 45;
    }


    // More than one explicit vlog phrase should not
    // explode the score.
    if (
        strongCount >= 2
    ) {

        score += 10;
    }


    if (
        lifestyleCount > 0
    ) {

        score += 30;
    }


    if (
        lifestyleCount >= 2
    ) {

        score += 10;
    }


    if (
        personalCount > 0
    ) {

        score += 20;
    }


    if (
        personalCount >= 2
    ) {

        score += 5;
    }


    /*
     * Generic topic words receive only a small bonus.
     *
     * "travel" alone must NOT turn an article/promo
     * into a vlog.
     */
    if (
        weakCount > 0
    ) {

        score += Math.min(
            weakCount * 4,
            12
        );
    }


    // ========================================================
    // 8. COMBINATION BONUSES
    // ========================================================

    if (
        lifestyleCount > 0 &&
        personalCount > 0
    ) {

        score += 15;
    }


    if (
        strongCount > 0 &&
        personalCount > 0
    ) {

        score += 10;
    }


    /*
     * Personal creator + lifestyle topic is valuable even
     * when literal word "vlog" is absent.
     *
     * Example:
     *
     * "Come with me exploring Delhi today"
     */
    if (
        personalCount > 0 &&
        weakCount > 0
    ) {

        score += 10;
    }


    // ========================================================
    // 9. PROMOTIONAL PENALTY
    // ========================================================

    if (
        promotionalCount > 0
    ) {

        score -= Math.min(
            25 + (
                promotionalCount - 1
            ) * 10,
            50
        );
    }


    // ========================================================
    // 10. EXTERNAL-LINK / ARTICLE STYLE PENALTY
    // ========================================================

    const hasExternalLink =
        /https?:\/\/|www\./i.test(
            text
        );


    /*
     * A URL by itself is NOT enough to reject a creator.
     *
     * But:
     *
     * URL + no strong vlog evidence + no personal evidence
     *
     * is commonly an article, promotion or external-link post.
     */
    if (
        hasExternalLink &&
        strongCount === 0 &&
        personalCount === 0
    ) {

        score -= 20;
    }


    // ========================================================
    // 11. GENERIC TOPIC SAFETY
    // ========================================================

    /*
     * This is the important part.
     *
     * "travel india"
     * "street food delhi"
     * "restaurant india"
     *
     * alone should NOT become a vlog.
     *
     * They remain below the existing >= 30 gate unless
     * another real vlog/personal/lifestyle signal exists.
     */
    if (
        strongCount === 0 &&
        lifestyleCount === 0 &&
        personalCount === 0
    ) {

        score = Math.min(
            score,
            22
        );
    }


    // ========================================================
    // FINAL
    // ========================================================

    return Math.max(
        0,
        Math.min(
            score,
            100
        )
    );
}

// ============================================================
// BLUESKY COUNTRY SCORE
// ============================================================

function calculateCountryScore(
    post,
    countryCode
) {

    // ========================================================
    // BASIC DATA
    // ========================================================

    const postText =
        normalizeSignalText(
            getPostText(post)
        );


    const authorText =
        normalizeSignalText(
            [
                post?.author?.displayName,
                post?.author?.handle,
                post?.author?.description
            ]
                .filter(Boolean)
                .join(" ")
        );


    const combinedText =
        normalizeSignalText(
            `${postText} ${authorText}`
        );


    const languages =
        Array.isArray(
            post?.record?.langs
        )
            ? post.record.langs
                .map(
                    item =>
                        cleanText(item)
                            .toLowerCase()
                            .split("-")[0]
                )
                .filter(Boolean)
            : [];


    const country =
        cleanText(
            countryCode
        )
            .toUpperCase();


    if (
        !country ||
        country === "GLOBAL"
    ) {
        return 0;
    }


    const config =
        getCountrySignalConfig(
            country
        );


    // ========================================================
    // SIGNAL COUNTERS
    // ========================================================

    let explicitCountryMatches = 0;
    let locationMatches = 0;
    let weakMatches = 0;
    let localLanguageMatches = 0;


    // ========================================================
    // EXPLICIT COUNTRY SIGNAL
    // ========================================================

    for (
        const signal
        of config.country
    ) {

        if (
            containsLocationSignal(
                combinedText,
                signal
            )
        ) {

            explicitCountryMatches++;
        }
    }


    // ========================================================
    // CITY / STATE / REGION SIGNAL
    // ========================================================

    for (
        const signal
        of config.locations
    ) {

        if (
            containsLocationSignal(
                combinedText,
                signal
            )
        ) {

            locationMatches++;
        }
    }


    // ========================================================
    // NATIONALITY / WEAKER SIGNAL
    // ========================================================

    for (
        const signal
        of config.weak
    ) {

        if (
            containsLocationSignal(
                combinedText,
                signal
            )
        ) {

            weakMatches++;
        }
    }


    // ========================================================
    // LOCAL LANGUAGE SIGNAL
    // ========================================================

    for (
        const language
        of languages
    ) {

        if (
            config.languages.includes(
                language
            )
        ) {

            localLanguageMatches++;
        }
    }


    // ========================================================
    // SCORE
    //
    // IMPORTANT:
    // Country name alone is NOT enough for STRONG LOCAL.
    //
    // "India travel in Delhi"        -> strong
    // "Daily life in Mumbai"         -> strong
    // Hindi + India                  -> strong
    // "Indian restaurant Hollywood"  -> should stay weak
    // ========================================================

    let score = 0;


    // Country mention alone = useful, but NOT strong.
    if (
        explicitCountryMatches > 0
    ) {
        score += 30;
    }


    // Real city/state/region is much stronger evidence.
    if (
        locationMatches > 0
    ) {
        score += 60;
    }


    // Multiple local locations reinforce confidence.
    if (
        locationMatches >= 2
    ) {
        score += 10;
    }


    // Nationality adjective alone is weak.
    if (
        weakMatches > 0
    ) {
        score += 10;
    }


    // Local language alone helps, but cannot prove location.
    if (
        localLanguageMatches > 0
    ) {
        score += 20;
    }


    // ========================================================
    // COMBINATION BONUSES
    // ========================================================

    if (
        explicitCountryMatches > 0 &&
        locationMatches > 0
    ) {

        score += 20;
    }


    if (
        explicitCountryMatches > 0 &&
        localLanguageMatches > 0
    ) {

        score += 20;
    }


    if (
        locationMatches > 0 &&
        localLanguageMatches > 0
    ) {

        score += 15;
    }


    // ========================================================
    // INDIA-SPECIFIC FOREIGN LOCATION CONFLICT
    //
    // This prevents examples like:
    //
    // "Indian restaurant Hollywood"
    // "Indian food in London"
    // "Indian restaurant New York"
    //
    // from being classified as strongly located in India.
    //
    // IMPORTANT:
    // We only apply this when there is NO Indian city/state
    // evidence. Delhi/Mumbai/etc. always wins.
    // ========================================================

    if (
        country === "IN" &&
        locationMatches === 0
    ) {

        const foreignLocationSignals = [

            "hollywood",
            "los angeles",
            "california",
            "new york",
            "nyc",
            "chicago",
            "texas",
            "florida",

            "london",
            "manchester",
            "birmingham",

            "toronto",
            "vancouver",

            "sydney",
            "melbourne",

            "dubai",
            "abu dhabi",

            "singapore",

            "paris",
            "berlin",
            "tokyo",
            "seoul"
        ];


        let foreignLocationFound = false;


        for (
            const signal
            of foreignLocationSignals
        ) {

            if (
                containsLocationSignal(
                    postText,
                    signal
                )
            ) {

                foreignLocationFound = true;
                break;
            }
        }


        if (
            foreignLocationFound
        ) {

            /*
             * Do not make the score negative.
             *
             * Example:
             *
             * "Indian restaurant Hollywood"
             *
             * India + Indian may initially score 40,
             * then foreign-location penalty pushes it
             * below POSSIBLE LOCAL.
             */
            score -= 35;
        }
    }


    // ========================================================
    // GENERIC "INDIA REFERENCE" PHRASES
    //
    // These phrases often talk ABOUT India without showing
    // that the video itself is local Indian content.
    // ========================================================

    if (
        country === "IN" &&
        locationMatches === 0
    ) {

        const referenceOnlySignals = [

            "reminds you of india",
            "taste of india",
            "flavors of india",
            "flavours of india",
            "inspired by india",
            "indian restaurant",
            "indian cuisine"
        ];


        let referenceOnlyFound = false;


        for (
            const signal
            of referenceOnlySignals
        ) {

            if (
                containsLocationSignal(
                    postText,
                    signal
                )
            ) {

                referenceOnlyFound = true;
                break;
            }
        }


        if (
            referenceOnlyFound
        ) {

            score -= 20;
        }
    }


    // ========================================================
    // FINAL SAFETY
    // ========================================================

    return Math.max(
        0,
        Math.min(
            score,
            100
        )
    );
}

const COUNTRY_SIGNAL_CONFIG = {

    IN: {

        country: [
            "india",
            "भारत",
            "hindustan"
        ],

        locations: [
            "delhi",
            "new delhi",
            "mumbai",
            "kolkata",
            "chennai",
            "bangalore",
            "bengaluru",
            "hyderabad",
            "pune",
            "patna",
            "bihar",
            "jaipur",
            "rajasthan",
            "lucknow",
            "uttar pradesh",
            "varanasi",
            "punjab",
            "kerala",
            "kochi",
            "gujarat",
            "ahmedabad",
            "chandigarh",
            "bhopal",
            "indore",
            "surat",
            "ranchi",
            "jharkhand",
            "goa",

            // Strong landmark/location evidence
            "taj mahal",
            "agra"
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
    },


    JP: {

        country: [
            "japan",
            "日本"
        ],

        locations: [
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
    },


    AE: {

        country: [
            "uae",
            "united arab emirates",
            "الإمارات"
        ],

        locations: [
            "dubai",
            "دبي",
            "abu dhabi",
            "أبوظبي",
            "sharjah"
        ],

        weak: [
            "emirati",
            "emirates"
        ],

        languages: []
    },


    KR: {

        country: [
            "south korea",
            "korea",
            "대한민국",
            "한국"
        ],

        locations: [
            "seoul",
            "서울",
            "busan",
            "부산"
        ],

        weak: [
            "korean"
        ],

        languages: [
            "ko"
        ]
    },


    US: {

        country: [
            "united states",
            "usa",
            "u.s.a",
            "america"
        ],

        locations: [
            "new york",
            "los angeles",
            "chicago",
            "san francisco",
            "las vegas",
            "miami",
            "washington dc"
        ],

        weak: [
            "american"
        ],

        /*
         * English alone is NOT useful US evidence.
         */
        languages: []
    },


    GB: {

        country: [
            "united kingdom",
            "uk",
            "u.k."
        ],

        locations: [
            "london",
            "manchester",
            "birmingham",
            "edinburgh",
            "glasgow"
        ],

        weak: [
            "british"
        ],

        languages: []
    },


    DE: {

        country: [
            "germany",
            "deutschland"
        ],

        locations: [
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
    },


    FR: {

        country: [
            "france"
        ],

        locations: [
            "paris",
            "lyon",
            "marseille",
            "nice"
        ],

        weak: [
            "french",
            "français",
            "française"
        ],

        languages: [
            "fr"
        ]
    },


    BR: {

        country: [
            "brazil",
            "brasil"
        ],

        locations: [
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
    }
};


function getCountrySignalConfig(
    countryCode
) {

    const country =
        cleanText(
            countryCode
        )
            .toUpperCase();


    return (
        COUNTRY_SIGNAL_CONFIG[
            country
        ] || {

            country: [],
            locations: [],
            weak: [],
            languages: []
        }
    );
}

function escapeRegExp(
    value
) {

    return String(
        value || ""
    )
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
}


function containsLocationSignal(
    text,
    signal
) {

    const normalizedText =
        normalizeSignalText(
            text
        );


    const normalizedSignal =
        normalizeSignalText(
            signal
        );


    if (
        !normalizedText ||
        !normalizedSignal
    ) {
        return false;
    }


    /*
     * Non-Latin scripts ke liye direct match.
     */
    if (
        /[^\x00-\x7F]/.test(
            normalizedSignal
        )
    ) {

        return normalizedText.includes(
            normalizedSignal
        );
    }


    const escaped =
        escapeRegExp(
            normalizedSignal
        );


    const pattern =
        new RegExp(
            `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,
            "i"
        );


    return pattern.test(
        normalizedText
    );
}

// ============================================================
// BLUESKY ENGAGEMENT
// ============================================================

function calculateEngagement(post) {

    const likes =
        safeNumber(
            post?.likeCount
        );

    const reposts =
        safeNumber(
            post?.repostCount
        );

    const replies =
        safeNumber(
            post?.replyCount
        );

    const quotes =
        safeNumber(
            post?.quoteCount
        );

    return (
        likes +
        (reposts * 2.5) +
        (replies * 1.5) +
        (quotes * 2)
    );
}


// ============================================================
// ORIGINAL BLUESKY POST URL
// ============================================================

function createOriginalPostUrl(post) {

    const handle =
        cleanText(
            post?.author?.handle
        );

    const uri =
        cleanText(
            post?.uri
        );

    if (
        !handle ||
        !uri
    ) {
        return null;
    }

    const parts =
        uri.split("/");

    const rkey =
        parts[
            parts.length - 1
        ];

    if (!rkey) {
        return null;
    }

    return (
        "https://bsky.app/profile/" +
        `${encodeURIComponent(handle)}/post/` +
        encodeURIComponent(rkey)
    );
}


// ============================================================
// CONVERT BLUESKY POST
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
        Array.isArray(
            post?.record?.langs
        )
            ? post.record.langs
            : [];

    return {

        id:
            cleanText(
                post?.uri
            ),

        provider:
            "bluesky",

        // ----------------------------------------------------
        // VIDEO
        // ----------------------------------------------------

        videoUrl:
            video.playlist,

        thumbnailUrl:
            video.thumbnail,

        // ----------------------------------------------------
        // CONTENT
        // ----------------------------------------------------

        caption:
            getPostText(post),

        language:
            languages.length > 0
                ? languages[0]
                : null,

        // ----------------------------------------------------
        // CREATOR
        // ----------------------------------------------------

        creatorId:
            cleanText(
                author?.did
            ),

        creatorName:
            cleanText(
                author?.displayName
            ) ||
            cleanText(
                author?.handle
            ) ||
            "Bluesky Creator",

        creatorHandle:
            cleanText(
                author?.handle
            ),

        creatorAvatar:
            cleanText(
                author?.avatar
            ) ||
            null,

        // ----------------------------------------------------
        // ORIGINAL SOURCE
        // ----------------------------------------------------

        originalPostUrl:
            createOriginalPostUrl(
                post
            ),

        // ----------------------------------------------------
        // RANKING
        // ----------------------------------------------------

        countryCode:
            cleanText(
                countryCode
            ).toUpperCase(),

        countryScore,

        vlogScore,

        engagementScore,

        // ----------------------------------------------------
        // RAW ENGAGEMENT
        // ----------------------------------------------------

        likes:
            safeNumber(
                post?.likeCount
            ),

        comments:
            safeNumber(
                post?.replyCount
            ),

        shares:
            safeNumber(
                post?.repostCount
            ),

        quotes:
            safeNumber(
                post?.quoteCount
            ),

        // ----------------------------------------------------
        // DEBUG
        // ----------------------------------------------------

        matchedQuery,

        indexedAt:
            post?.indexedAt ||
            null
    };
}


// ============================================================
// PART 1 END
// PART 2 MUST BE PASTED DIRECTLY BELOW THIS LINE
// ============================================================


// ============================================================
// FETCH BLUESKY VLOGS
// ============================================================

async function fetchBlueskyVlogs(
    countryCode,
    requestedLimit,
    encodedCursor = null
) {

    const queries =
        getCountryQueries(
            countryCode
        );


    // ========================================================
    // DECODE OUR OWN PAGINATION STATE
    // ========================================================

    const decodedState =
        decodeBlueskyCursor(
            encodedCursor
        );


    /*
     * NEW FORMAT:
     *
     * {
     *     untils: {
     *         "india vlog": "2026-10-20T10:20:30.000Z",
     *         "hindi vlog": "2026-10-18T08:15:00.000Z"
     *     },
     *
     *     seen: [
     *         "at://...",
     *         "at://..."
     *     ]
     * }
     */


    const untilMap =
        decodedState &&
        typeof decodedState === "object" &&
        !Array.isArray(decodedState) &&
        decodedState.untils &&
        typeof decodedState.untils === "object" &&
        !Array.isArray(decodedState.untils)
            ? decodedState.untils
            : {};


    const previouslyReturned =
        new Set(
            decodedState &&
            typeof decodedState === "object" &&
            !Array.isArray(decodedState) &&
            Array.isArray(decodedState.seen)
                ? decodedState.seen
                    .map(
                        id =>
                            cleanText(id)
                    )
                    .filter(Boolean)
                : []
        );


    /*
     * First page:
     *
     * Sab queries active hain.
     *
     * Later pages:
     *
     * Sirf woh queries active rahengi jinke
     * paas previous page se nextUntil hai.
     */

    const firstPage =
        !encodedCursor;


    const nextUntilMap = {};


    console.log(
        `🦋 BLUESKY TIME PAGINATION` +
        ` | country=${countryCode}` +
        ` | page=${firstPage ? "FIRST" : "CONTINUE"}` +
        ` | activeUntil=${Object.keys(untilMap).length}` +
        ` | previouslyReturned=${previouslyReturned.size}`
    );


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
junkBlocked: 0,
        vlogRejected: 0,

        vlogPassed: 0
    };


    // ========================================================
    // SEARCH COUNTRY QUERIES
    // ========================================================

    for (
        const query
        of queries
    ) {

        /*
         * Later page par agar query exhausted thi,
         * usko dobara latest se start nahi karna.
         */

        if (
            !firstPage &&
            !Object.prototype.hasOwnProperty.call(
                untilMap,
                query
            )
        ) {

            console.log(
                `⏭️ BLUESKY QUERY EXHAUSTED` +
                ` | query=${query}`
            );

            continue;
        }


        debug.searchesAttempted++;


        const queryUntil =
            firstPage
                ? null
                : untilMap[query];


        const search =
            await searchPosts(
                query,
                queryUntil
            );


        // ====================================================
        // SUCCESS
        // ====================================================

        if (
            search.status === 200
        ) {

            debug.searchesSuccessful++;
        }


        debug.postsReceived +=
            search.posts.length;


        /*
         * Successful search + older results available:
         * save our own timestamp boundary.
         */

        if (
            search.status === 200 &&
            search.hasMore &&
            search.nextUntil
        ) {

            nextUntilMap[query] =
                search.nextUntil;
        }


        // ====================================================
        // POSTS
        // ====================================================

        for (
            const post
            of search.posts
        ) {

            const id =
                cleanText(
                    post?.uri
                );


            if (!id) {
                continue;
            }


            // ------------------------------------------------
            // PREVIOUS PAGE DUPLICATE
            // ------------------------------------------------

            if (
                previouslyReturned.has(id)
            ) {

                debug.duplicates++;

                console.log(
                    `♻️ BLUESKY OLD PAGE SKIP` +
                    ` | id=${id}` +
                    ` | query=${query}`
                );

                continue;
            }


            // ------------------------------------------------
            // SAME REQUEST DUPLICATE
            // ------------------------------------------------

            if (
                unique.has(id)
            ) {

                debug.duplicates++;

                continue;
            }


            // ------------------------------------------------
            // VIDEO
            // ------------------------------------------------

            const video =
                extractVideo(
                    post
                );


            if (!video) {

                debug.noVideo++;

                continue;
            }


            debug.videosFound++;


            // ------------------------------------------------
            // TEXT
            // ------------------------------------------------

            const text =
                getPostText(
                    post
                );


// ------------------------------------------------
// HARD BLOCK
// ------------------------------------------------

if (
    containsBlockedContent(
        text
    )
) {

    debug.blocked++;

    continue;
}


// ------------------------------------------------
// BLUESKY JUNK / BOT / REPOST BLOCK
// ------------------------------------------------

if (
    containsBlueskyJunk(
        post
    )
) {

    debug.junkBlocked++;


    console.log(
        `🤖 BLUESKY JUNK BLOCK` +
        ` | creator=${cleanText(
            post?.author?.displayName
        ) || cleanText(
            post?.author?.handle
        ) || "unknown"}` +
        ` | text=${text.substring(0, 220)}`
    );


    continue;
}


// ------------------------------------------------
// VLOG SCORE
// ------------------------------------------------

const vlogScore =
    calculateVlogScore(
        post
    );



            if (
                vlogScore < 30
            ) {

                debug.vlogRejected++;

                continue;
            }


            debug.vlogPassed++;


            // ------------------------------------------------
            // CONVERT
            // ------------------------------------------------

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


        // ====================================================
        // ENOUGH CANDIDATES
        // ====================================================

        if (
            unique.size >=
            requestedLimit * 3
        ) {

            break;
        }


        await sleep(100);
    }


    // ========================================================
    // RANK
    // ========================================================

    const ranked =
        Array.from(
            unique.values()
        )
            .sort(
                (a, b) => {

                    // 1. VLOG QUALITY

                    if (
                        b.vlogScore !==
                        a.vlogScore
                    ) {

                        return (
                            b.vlogScore -
                            a.vlogScore
                        );
                    }


                    // 2. COUNTRY

                    if (
                        b.countryScore !==
                        a.countryScore
                    ) {

                        return (
                            b.countryScore -
                            a.countryScore
                        );
                    }


                    // 3. ENGAGEMENT

                    return (
                        b.engagementScore -
                        a.engagementScore
                    );
                }
            );


    // ========================================================
    // COUNTRY TIERS
    // ========================================================

    const strongCountry =
        ranked.filter(
            item =>
                item.countryScore >= 60
        );


    // const possibleCountry =
    //     ranked.filter(
    //         item =>
    //             item.countryScore >= 30 &&
    //             item.countryScore < 60
    //     );

    const possibleCountry =
    ranked.filter(
        item =>
            item.countryScore >= 35 &&
            item.countryScore < 60
    );

    const weakCountry =
        ranked.filter(
            item =>
                item.countryScore < 30
        );


    // ========================================================
    // FINAL
    // ========================================================


const isGlobalRequest =
    cleanText(countryCode)
        .toUpperCase() === "GLOBAL";


const rankedByCountry =
    isGlobalRequest
        ? ranked
        : [
            ...strongCountry,
            ...possibleCountry
        ];


console.log(
    `🌍 BLUESKY COUNTRY GATE` +
    ` | country=${countryCode}` +
    ` | strong=${strongCountry.length}` +
    ` | possible=${possibleCountry.length}` +
    ` | weak=${weakCountry.length}` +
    ` | eligible=${rankedByCountry.length}` +
    ` | weakAllowed=${isGlobalRequest}`
);

const final =
    diversifyByCreator(
        rankedByCountry,
        requestedLimit,

        item =>
            item?.creatorId ||
            item?.authorDid ||
            item?.creatorName ||
            ""
    );

    const finalCreatorCount =
    new Set(
        final
            .map(
                item =>
                    cleanText(
                        item?.creatorId ||
                        item?.authorDid ||
                        item?.creatorName
                    )
                        .toLowerCase()
            )
            .filter(Boolean)
    ).size;


console.log(
    `🦋 BLUESKY DIVERSITY` +
    ` | candidates=${rankedByCountry.length}` +
    ` | returned=${final.length}` +
    ` | creators=${finalCreatorCount}`
);

    // ========================================================
    // REMEMBER RETURNED IDs
    // ========================================================

    const returnedIds =
        final
            .map(
                item =>
                    cleanText(
                        item?.id
                    )
            )
            .filter(Boolean);


    const seenForNextPage =
        [
            ...previouslyReturned,
            ...returnedIds
        ]
            .filter(
                (
                    id,
                    index,
                    array
                ) =>
                    array.indexOf(id) ===
                    index
            )
            .slice(-200);


    // ========================================================
    // HAS MORE
    // ========================================================

    const hasMore =
        Object.keys(
            nextUntilMap
        ).length > 0;


    // ========================================================
    // OUR OWN CURSOR
    // ========================================================

    const nextCursor =
        hasMore
            ? encodeBlueskyCursor({

                untils:
                    nextUntilMap,

                seen:
                    seenForNextPage

            })
            : null;


    console.log(
        `🦋 BLUESKY TIME PAGINATION DONE` +
        ` | returned=${final.length}` +
        ` | remembered=${seenForNextPage.length}` +
        ` | hasMore=${hasMore}` +
        ` | activeQueries=${Object.keys(nextUntilMap).length}`
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
            final,

        nextCursor,

        hasMore
    };
}


// ============================================================
// MASTODON HELPERS
// ============================================================

function stripHtml(
    value = ""
) {

    return String(value)
        .replace(
            /<br\s*\/?>/gi,
            " "
        )
        .replace(
            /<\/p>/gi,
            " "
        )
        .replace(
            /<[^>]*>/g,
            " "
        )
        .replace(
            /&nbsp;/gi,
            " "
        )
        .replace(
            /&amp;/gi,
            "&"
        )
        .replace(
            /&lt;/gi,
            "<"
        )
        .replace(
            /&gt;/gi,
            ">"
        )
        .replace(
            /&quot;/gi,
            "\""
        )
        .replace(
            /&#39;/gi,
            "'"
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}


function normalizeMastodonLanguage(
    language
) {

    if (!language) {
        return null;
    }

    return (
        String(language)
            .trim()
            .toLowerCase()
            .split("-")[0] ||
        null
    );
}


// ============================================================
// MASTODON COUNTRY WORDS
// ============================================================

function mastodonCountryWords(
    countryCode
) {

    const config =
        getCountrySignalConfig(
            countryCode
        );


    return {

        strong: [
            ...config.country,
            ...config.locations
        ],

        weak: [
            ...config.weak
        ],

        languages: [
            ...config.languages
        ]
    };
}


// ============================================================
// NORMALIZE TEXT FOR SIGNAL MATCHING
// ============================================================

function normalizeSignalText(
    value
) {

    return String(
        value || ""
    )
        .toLowerCase()
        .replace(
            /https?:\/\/\S+/gi,
            " "
        )
        .replace(
            /www\.\S+/gi,
            " "
        )
        .replace(
            /[_#|]+/g,
            " "
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}


// ============================================================
// COUNT SIGNALS
// ============================================================

function countSignals(
    text,
    signals
) {

    let count = 0;

    for (
        const signal
        of signals
    ) {

        if (
            text.includes(signal)
        ) {
            count++;
        }
    }

    return count;
}


// ============================================================
// MASTODON COUNTRY SCORE
// ============================================================

function calculateMastodonCountryScore(
    countryCode,
    text,
    language,
    tags = []
) {

    const country =
        cleanText(
            countryCode ||
            "GLOBAL"
        )
            .toUpperCase();


    if (
        !country ||
        country === "GLOBAL"
    ) {
        return 0;
    }


    const config =
        getCountrySignalConfig(
            country
        );


    const safeTags =
        Array.isArray(tags)
            ? tags
            : [];


    const combined =
        normalizeSignalText(
            [
                text,
                safeTags.join(" ")
            ]
                .filter(Boolean)
                .join(" ")
        );


    let score = 0;


    // ========================================================
    // EXPLICIT COUNTRY
    // ========================================================

    for (
        const signal
        of config.country
    ) {

        if (
            containsLocationSignal(
                combined,
                signal
            )
        ) {

            score += 70;
        }
    }


    // ========================================================
    // CITY / REGION
    // ========================================================

    for (
        const signal
        of config.locations
    ) {

        if (
            containsLocationSignal(
                combined,
                signal
            )
        ) {

            score += 55;
        }
    }


    // ========================================================
    // NATIONALITY / WEAK SIGNAL
    // ========================================================

    for (
        const signal
        of config.weak
    ) {

        if (
            containsLocationSignal(
                combined,
                signal
            )
        ) {

            score += 25;
        }
    }


    // ========================================================
    // LANGUAGE SUPPORT
    // ========================================================

    const lang =
        normalizeMastodonLanguage(
            language
        );


    if (
        lang &&
        config.languages.includes(
            lang
        )
    ) {

        score += 20;
    }


    // ========================================================
    // EXPLICIT HASHTAG BONUS
    // ========================================================

    const normalizedTags =
        safeTags
            .map(
                tag =>
                    String(
                        tag || ""
                    )
                        .toLowerCase()
                        .replace(
                            /^#/,
                            ""
                        )
                        .replace(
                            /[_\-\s]+/g,
                            ""
                        )
                        .trim()
            )
            .filter(Boolean);


    const strongHashtagSignals =
        [
            ...config.country,
            ...config.locations
        ];


    for (
        const signal
        of strongHashtagSignals
    ) {

        const normalizedSignal =
            String(
                signal || ""
            )
                .toLowerCase()
                .replace(
                    /[_\-\s#]+/g,
                    ""
                )
                .trim();


        if (
            normalizedSignal &&
            normalizedTags.includes(
                normalizedSignal
            )
        ) {

            score += 15;
        }
    }


    return Math.min(
        score,
        100
    );
}


// ============================================================
// MASTODON COMMERCIAL / PROMOTIONAL DETECTION
// ============================================================

function getMastodonCommercialScore(text = "") {

    const value = String(text || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    if (!value) {
        return 0;
    }

    let score = 0;

    // ====================================================
    // VERY STRONG COMMERCIAL INTENT
    // ====================================================

    const veryStrongSignals = [

        "book now",
        "book today",
        "book your",

        "booking now",

        "contact us",
        "contact now",
        "contact our team",

        "call us",
        "call now",

        "whatsapp us",
        "whatsapp now",

        "dm us",
        "dm for",

        "limited offer",
        "special offer",

        "get a quote",
        "request a quote",

        "buy now",
        "order now",
        "shop now",

        "available for booking",
        "reserve now",

        "request a demo",
        "book a demo",

        "get started today",

        "free consultation"
    ];

    for (const signal of veryStrongSignals) {

        if (value.includes(signal)) {
            score += 3;
        }
    }

    // ====================================================
    // BUSINESS / SERVICE SIGNALS
    // ====================================================

    const businessSignals = [

        "car rental",
        "rent a car",
        "chauffeur",

        "airport transfer",

        "taxi service",
        "cab service",

        "tour package",
        "tour packages",

        "travel package",
        "travel packages",

        "holiday package",
        "holiday packages",

        "visa assistance",
        "visa service",

        "travel agency",
        "travel company",

        "corporate travel",

        "our services",
        "our service",

        "our customers",
        "our clients",

        "customer service",

        "delivery service",

        "our company",
        "our business",
        "our team",
        "our office",
        "our employees",

        "our product",
        "our products",
        "our brand",

        "our solution",
        "our solutions",

        "our platform",

        "visit our website",

        "sign up",

        "download now"
    ];

    for (const signal of businessSignals) {

        if (value.includes(signal)) {
            score += 2;
        }
    }

    // ====================================================
    // CONTACT / SALES INFORMATION
    // ====================================================

    const contactSignals = [

        "contact:",
        "contact -",

        "phone:",
        "phone -",

        "call:",
        "call -",

        "whatsapp:",
        "whatsapp -",

        "email:",
        "email -"
    ];

    for (const signal of contactSignals) {

        if (value.includes(signal)) {
            score += 2;
        }
    }

    // Email address
    if (
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(value)
    ) {
        score += 2;
    }

    // Phone / WhatsApp-like number
    if (
        /(?:\+?\d[\d\s().-]{7,}\d)/.test(value)
    ) {
        score += 2;
    }

    // Website link is only weak evidence.
    // A genuine creator may also have a link.
    if (
        /https?:\/\/|www\./i.test(value)
    ) {
        score += 1;
    }

    return score;
}


// ============================================================
// MASTODON HARD NON-VLOG DETECTION
// ============================================================

function containsMastodonHardBlock(text = "") {

    const value = String(text || "")
        .toLowerCase()
        .replace(/[_#-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!value) {
        return false;
    }

    const hardBlocks = [

        // ====================================================
        // GAMING
        // ====================================================

        "gameplay",
        "gaming stream",
        "gaming highlights",
        "walkthrough",
        "playthrough",
        "speedrun",
        "let's play",
        "lets play",

        // ====================================================
        // TUTORIAL / EDUCATIONAL INSTRUCTION
        // ====================================================

        "how to",
        "tutorial",
        "step by step",
        "course lesson",
        "online course",
        "coding tutorial",
        "programming tutorial",

        // ====================================================
        // REVIEWS / UNBOXING
        // ====================================================

        "product review",
        "tech review",
        "phone review",
        "car review",
        "food review",
        "restaurant review",
        "unboxing",
        "hands on review",

        // ====================================================
        // NEWS / POLITICS
        // ====================================================

        "breaking news",
        "news update",
        "news report",
        "daily news",
        "political news",
        "politics",
        "political",
        "election coverage",
        "journalism",

        // ====================================================
        // PODCAST / INTERVIEW
        // ====================================================

        "full podcast",
        "podcast episode",
        "podcast clip",
        "full interview",

        // ====================================================
        // MOVIE / TV / ENTERTAINMENT CLIPS
        // ====================================================

        "official trailer",
        "movie trailer",
        "film trailer",
        "movie clip",
        "film clip",
        "tv clip",
        "full episode",
        "episode trailer",

        // ====================================================
        // MUSIC CONTENT
        //
        // IMPORTANT:
        // Do NOT block generic "music", "artist", "studio".
        // Creator-life / studio vlogs should still pass.
        // ====================================================

        "official music video",
        "official audio",
        "official lyric video",
        "lyric video",
        "lyrics video",
        "full song",
        "full album",
        "new single out now",
        "stream my song",
        "listen to my song",
        "listen now on spotify",
        "available on spotify",
        "spotify link",

        // ====================================================
        // COMPILATIONS / RANDOM CLIPS
        // ====================================================

        "best moments compilation",
        "funny compilation",
        "clip compilation",
        "highlights compilation",

        // ====================================================
        // SCREEN RECORDINGS / SOFTWARE DEMOS
        // ====================================================

        "screen recording",
        "software demo",
        "app demo",

        // ====================================================
        // EXTERNAL VIDEO PROMOTION
        // ====================================================

        "subscribe to youtube",
        "subscribe on youtube",
        "subscribe to my youtube",
        "full video on youtube",
        "watch full video on youtube",
        "watch on youtube",

        // ====================================================
        // COMPANY / RECRUITMENT PROMOTION
        // ====================================================

        "join our team",
        "join our company",
        "apply now",
        "we are hiring",
        "now hiring",
        "career opportunity",
        "job opening",
        "become part of our team"
    ];

    return hardBlocks.some(
        phrase => value.includes(phrase)
    );
}


// ============================================================
// MASTODON VLOG SCORE
// ============================================================

function calculateMastodonVlogScore(
    text = "",
    tags = []
) {

    const rawText =
        String(text || "")
            .toLowerCase();

    const value =
        rawText
            .replace(/[_#-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const safeTags =
        Array.isArray(tags)
            ? tags
                .map(
                    tag =>
                        String(tag || "")
                            .toLowerCase()
                            .replace(/[_#\s-]+/g, "")
                )
                .filter(Boolean)
            : [];


    // ====================================================
    // HARD BLOCK
    // ====================================================

    if (
        containsMastodonHardBlock(
            `${value} ${safeTags.join(" ")}`
        )
    ) {
        return 0;
    }


    // ====================================================
    // COMMERCIAL
    // ====================================================

    const commercialScore =
        getMastodonCommercialScore(
            value
        );

    if (
        commercialScore >= 4
    ) {
        return 0;
    }


    let score = 0;


    // ====================================================
    // VERY STRONG PERSONAL VLOG SIGNALS
    // ====================================================

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

        "life in ",
        "living in ",

        "come with me",
        "come along with me",

        "spend the day with me",
        "day with me",
        "a day with me",

        "join me for the day",
        "follow me for the day",

        "weekend in my life"
    ];


    const veryStrongHits =
        countSignals(
            value,
            veryStrongSignals
        );


    if (
        veryStrongHits > 0
    ) {

        score += 40;

        score +=
            Math.min(
                (veryStrongHits - 1) * 10,
                20
            );
    }


    // ====================================================
    // EXPLICIT VLOG WORD
    // ====================================================

    const explicitVlogSignals = [
        "vlog",
        "vlogging"
    ];


    const explicitVlogHits =
        countSignals(
            value,
            explicitVlogSignals
        );


    if (
        explicitVlogHits > 0
    ) {

        score += 35;
    }


    // ====================================================
    // PERSONAL EXPERIENCE
    // ====================================================

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

        "our trip",
        "our journey",
        "our vacation",

        "we went",
        "we visited",
        "we travelled",
        "we traveled",

        "i went",
        "i visited",
        "i travelled",
        "i traveled",

        "today i",
        "today we",

        "i spent",
        "we spent",

        "i'm visiting",
        "im visiting",
        "i am visiting",

        "i explored",
        "we explored",

        "i tried",
        "we tried"
    ];


    const personalHits =
        countSignals(
            value,
            personalSignals
        );


    if (
        personalHits > 0
    ) {

        score += 25;

        score +=
            Math.min(
                (personalHits - 1) * 6,
                12
            );
    }


    // ====================================================
    // EXPERIENCE / LIFESTYLE
    // ====================================================

    const experienceSignals = [

        "road trip",

        "city walk",
        "walking around",

        "street food",

        "food tour",
        "food trip",

        "cafe hopping",
        "café hopping",

        "shopping day",

        "family time",

        "grwm",
        "get ready with me",

        "behind the scenes",

        "work day",
        "work life",

        "weekend trip",

        "exploring ",
        "explore with me"
    ];


    const experienceHits =
        countSignals(
            value,
            experienceSignals
        );


    if (
        experienceHits > 0
    ) {

        score += 18;

        score +=
            Math.min(
                (experienceHits - 1) * 5,
                10
            );
    }


    // ====================================================
    // GENERIC CONTEXT
    //
    // Helpful, but NEVER enough alone.
    // ====================================================

    const genericSignals = [

        "daily life",
        "everyday life",

        "travel",
        "travelling",
        "traveling",

        "trip",
        "vacation",
        "holiday",
        "journey",

        "weekend",

        "shopping",

        "family",

        "restaurant",
        "cafe",

        "breakfast",
        "lunch",
        "dinner",

        "market",

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


    const genericHits =
        countSignals(
            value,
            genericSignals
        );


    score +=
        Math.min(
            genericHits * 4,
            12
        );


    // ====================================================
    // VLOG HASHTAGS
    // ====================================================

    const strongTags =
        new Set([

            "vlog",
            "vlogging",

            "dailyvlog",
            "minivlog",

            "travelvlog",
            "foodvlog",
            "familyvlog",

            "collegevlog",
            "studentvlog",
            "lifestylevlog",

            "dayinmylife",
            "weekinmylife",

            // Country-specific vlog communities
            "indiavlog",
            "indianvlog",
            "indianvlogger"
        ]);


    const weakTags =
        new Set([

            "dailylife",
            "everydaylife",

            "lifestyle",

            "roadtrip",

            "vacation",
            "holiday",

            "citylife",

            "studentlife",
            "collegelife"
        ]);


    const strongTagHits =
        safeTags.filter(
            tag =>
                strongTags.has(tag)
        ).length;


    const weakTagHits =
        safeTags.filter(
            tag =>
                weakTags.has(tag)
        ).length;


    // ====================================================
    // EVIDENCE
    // ====================================================

    const strongTextEvidence =
        veryStrongHits +
        explicitVlogHits +
        personalHits;


    const supportingTextEvidence =
        experienceHits +
        genericHits;


    // ====================================================
    // STRONG VLOG HASHTAG
    //
    // Mastodon captions can be extremely short.
    // Therefore a real vlog-specific hashtag can be
    // meaningful evidence, but generic lifestyle tags
    // cannot independently prove a vlog.
    // ====================================================

    if (
        strongTagHits > 0
    ) {

        if (
            strongTextEvidence > 0
        ) {

            score +=
                Math.min(
                    strongTagHits * 15,
                    30
                );

        } else if (
            supportingTextEvidence > 0
        ) {

            score +=
                Math.min(
                    strongTagHits * 12,
                    24
                );

        } else {

            score +=
                Math.min(
                    strongTagHits * 10,
                    20
                );
        }
    }


    score +=
        Math.min(
            weakTagHits * 4,
            8
        );


    // ====================================================
    // SHORT MASTODON CAPTION SUPPORT
    //
    // Explicit vlog-community hashtag + at least some
    // lifestyle/context evidence can cross the threshold.
    // ====================================================

    if (
        strongTagHits > 0 &&
        supportingTextEvidence > 0
    ) {

        score += 12;
    }


    // ====================================================
    // COMMERCIAL PENALTY
    // ====================================================

    score -=
        commercialScore * 12;


    // ====================================================
    // QUALITY GATES
    // ====================================================

    /*
     * No personal/vlog evidence AND no vlog-specific hashtag:
     * generic India/travel/food/location tags cannot create
     * a vlog by themselves.
     */
    if (
        strongTextEvidence === 0 &&
        strongTagHits === 0
    ) {

        return Math.max(
            0,
            Math.min(
                Math.round(score),
                25
            )
        );
    }


    /*
     * A bare #vlog/#indiavlog on completely contextless
     * content is still not enough to automatically pass 40.
     */
    if (
        strongTextEvidence === 0 &&
        supportingTextEvidence === 0
    ) {

        return Math.max(
            0,
            Math.min(
                Math.round(score),
                30
            )
        );
    }


    // ====================================================
    // FINAL
    // ====================================================

    return Math.max(
        0,
        Math.min(
            Math.round(score),
            100
        )
    );
}


// ============================================================
// MASTODON HASHTAGS
// ============================================================

const MASTODON_HASHTAGS = {

   IN: [

    // ========================================================
    // INDIA — COUNTRY SIGNALS
    // ========================================================

    "india",
    "indiavlog",
    "indianvlogger",

    // ========================================================
    // INDIA — TRAVEL / FOOD
    // ========================================================

    "travelindia",
    "indianfood",

    // ========================================================
    // MAJOR LOCAL SIGNALS
    // ========================================================

    "delhi",
    "mumbai",
    "bengaluru",

    // ========================================================
    // REGIONAL DISCOVERY
    // ========================================================

    "kerala",
    "goa",
    "ranchi",
    "patna"
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

    "dayinmylife",
    "dailylife",

    "travelvlog",
    "foodvlog",

    "lifestyle",

    "roadtrip",
    "citylife",

    "travel"
]
};


// ============================================================
// SELECT MASTODON HASHTAGS
// ============================================================

function getMastodonHashtags(countryCode) {

    const country =
        String(
            countryCode || "GLOBAL"
        )
            .trim()
            .toUpperCase();


    const globalTags =
        MASTODON_HASHTAGS.DEFAULT || [];


    // ========================================================
    // GLOBAL DISCOVERY
    //
    // GLOBAL means genuinely global.
    // Do NOT mix country-specific hashtags here.
    // ========================================================

    if (
        !country ||
        country === "GLOBAL"
    ) {

        return [
            ...new Set(
                globalTags
            )
        ].slice(
            0,
            8
        );
    }


    // ========================================================
    // COUNTRY DISCOVERY
    //
    // IMPORTANT:
    //
    // IN request  -> only Indian/local hashtags
    // JP request  -> only Japanese/local hashtags
    // BR request  -> only Brazilian/local hashtags
    //
    // Global fallback Android/manager handle karega.
    // ========================================================

    const localTags =
        MASTODON_HASHTAGS[country] || [];


    if (
        localTags.length > 0
    ) {

        return [
            ...new Set(
                localTags
            )
        ].slice(
            0,
            8
        );
    }


    // ========================================================
    // UNKNOWN COUNTRY
    //
    // Country configuration nahi hai to random country content
    // pretend nahi karenge.
    //
    // Global discovery use karenge as safe fallback.
    // ========================================================

    return [
        ...new Set(
            globalTags
        )
    ].slice(
        0,
        8
    );
}

// ============================================================
// PART 2 END
// PART 3 MUST BE PASTED DIRECTLY BELOW THIS LINE
// ============================================================


// ============================================================
// FETCH ONE MASTODON HASHTAG
// ============================================================

async function fetchMastodonHashtag(
    host,
    hashtag,
    maxId = null
) {

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            MASTODON_TIMEOUT_MS
        );


    try {

        const safeHost =
            String(host || "")
                .trim()
                .toLowerCase();


        const safeTag =
            String(hashtag || "")
                .trim()
                .replace(/^#/, "");


        if (
            !safeHost ||
            !safeTag
        ) {

            return {
                hashtag: safeTag,
                statuses: [],
                authRequired: false,
                status: 0,
                nextMaxId: null,
                hasMore: false
            };
        }


        // ====================================================
        // PARAMETERS
        // ====================================================

        const params =
            new URLSearchParams();


        params.set(
            "only_media",
            "true"
        );


        params.set(
            "limit",
            "40"
        );


        /*
         * IMPORTANT:
         *
         * Har hashtag ka APNA max_id aayega.
         */
        if (maxId) {

            params.set(
                "max_id",
                String(maxId)
            );
        }


        // ====================================================
        // URL
        // ====================================================

        const url =
            `https://${safeHost}` +
            `/api/v1/timelines/tag/` +
            `${encodeURIComponent(safeTag)}` +
            `?${params.toString()}`;


        // ====================================================
        // HEADERS
        // ====================================================

        const headers = {

            "Accept":
                "application/json",

            "User-Agent":
                "Vlogger/1.0"
        };


        /*
         * Token sirf mastodon.social ko.
         *
         * Kisi unknown host ko token forward nahi hoga.
         */
        if (
            safeHost === "mastodon.social" &&
            MASTODON_ACCESS_TOKEN
        ) {

            headers.Authorization =
                `Bearer ${MASTODON_ACCESS_TOKEN}`;
        }


        console.log(
            `🐘 MASTODON TAG REQUEST` +
            ` | tag=${safeTag}` +
            ` | maxId=${maxId || "FIRST"}`
        );


        // ====================================================
        // REQUEST
        // ====================================================

        const response =
            await fetch(
                url,
                {
                    method: "GET",
                    headers,
                    signal:
                        controller.signal
                }
            );


        const body =
            await response.text();


        // ====================================================
        // AUTH / RESTRICTED
        // ====================================================

        if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 422
        ) {

            return {
                hashtag: safeTag,
                statuses: [],
                authRequired: true,
                status: response.status,
                nextMaxId: null,
                hasMore: false
            };
        }


        // ====================================================
        // HTTP ERROR
        // ====================================================

        if (!response.ok) {

            console.log(
                `❌ MASTODON TAG FAILED` +
                ` | tag=${safeTag}` +
                ` | status=${response.status}` +
                ` | body=${body.substring(0, 200)}`
            );


            return {
                hashtag: safeTag,
                statuses: [],
                authRequired: false,
                status: response.status,
                nextMaxId: null,
                hasMore: false
            };
        }


        // ====================================================
        // JSON
        // ====================================================

        let data;


        try {

            data =
                JSON.parse(
                    body
                );

        } catch {

            return {
                hashtag: safeTag,
                statuses: [],
                authRequired: false,
                status: response.status,
                nextMaxId: null,
                hasMore: false
            };
        }


        const statuses =
            Array.isArray(data)
                ? data
                : [];


        // ====================================================
        // FIND NEXT max_id FOR THIS HASHTAG
        // ====================================================

        let nextMaxId =
            null;


        for (
            const status
            of statuses
        ) {

            const id =
                String(
                    status?.id ||
                    ""
                )
                    .trim();


            /*
             * Mastodon status IDs on this endpoint are
             * numeric strings.
             */
            if (
                !/^\d+$/.test(id)
            ) {
                continue;
            }


            if (
                nextMaxId === null ||
                BigInt(id) <
                    BigInt(nextMaxId)
            ) {

                nextMaxId =
                    id;
            }
        }


        // ====================================================
        // PREVENT STUCK CURSOR
        // ====================================================

        const cursorMoved =
            maxId === null ||
            (
                nextMaxId !== null &&
                String(nextMaxId) !==
                    String(maxId)
            );


        /*
         * Don't require statuses.length === 40.
         *
         * Some timelines can return fewer results while an
         * older max_id is still useful.
         *
         * Query is continued only while its boundary moves.
         */
        const hasMore =
            statuses.length > 0 &&
            nextMaxId !== null &&
            cursorMoved;


        console.log(
            `✅ MASTODON TAG` +
            ` | tag=${safeTag}` +
            ` | statuses=${statuses.length}` +
            ` | nextMaxId=${nextMaxId || "NONE"}` +
            ` | hasMore=${hasMore}`
        );


        return {

            hashtag:
                safeTag,

            statuses,

            authRequired:
                false,

            status:
                response.status,

            nextMaxId,

            hasMore
        };


    } catch (error) {

        console.log(
            `❌ MASTODON TAG ERROR` +
            ` | host=${host}` +
            ` | tag=${hashtag}` +
            ` | error=${error?.message || "unknown"}`
        );


        return {

            hashtag:
                String(
                    hashtag ||
                    ""
                ),

            statuses: [],

            authRequired:
                false,

            status:
                0,

            nextMaxId:
                null,

            hasMore:
                false
        };


    } finally {

        clearTimeout(
            timeout
        );
    }
}

function encodeMastodonCursor(
    state
) {

    try {

        return Buffer
            .from(
                JSON.stringify(
                    state
                ),
                "utf8"
            )
            .toString(
                "base64url"
            );

    } catch (error) {

        console.log(
            `❌ MASTODON CURSOR ENCODE ERROR` +
            ` | error=${error?.message || error}`
        );

        return null;
    }
}


function decodeMastodonCursor(
    encodedCursor
) {

    if (!encodedCursor) {
        return null;
    }


    try {

        const json =
            Buffer
                .from(
                    String(
                        encodedCursor
                    ),
                    "base64url"
                )
                .toString(
                    "utf8"
                );


        const parsed =
            JSON.parse(
                json
            );


        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {

            return null;
        }


        return parsed;


    } catch (error) {

        console.log(
            `❌ MASTODON CURSOR DECODE ERROR` +
            ` | error=${error?.message || error}`
        );

        return null;
    }
}

function diversifyByCreator(
    items,
    limit,
    creatorKeyGetter
) {

    const safeItems =
        Array.isArray(items)
            ? items.filter(Boolean)
            : [];


    const safeLimit =
        Math.max(
            Number(limit) || 0,
            0
        );


    if (
        safeItems.length === 0 ||
        safeLimit === 0
    ) {
        return [];
    }


    // ========================================================
    // GROUP BY CREATOR
    // ========================================================

    const groups =
        new Map();


    let unknownIndex = 0;


    for (
        const item
        of safeItems
    ) {

        let creatorKey =
            cleanText(
                creatorKeyGetter(item)
            )
                .toLowerCase();


        /*
         * Missing creator ID wale unrelated videos ko
         * ek hi creator mat samajhna.
         */
        if (!creatorKey) {

            const fallbackId =
                cleanText(
                    item?.id
                ) ||
                cleanText(
                    item?.uniqueId
                ) ||
                cleanText(
                    item?.videoUrl
                );


            creatorKey =
                fallbackId
                    ? `unknown:${fallbackId}`
                    : `unknown:${unknownIndex++}`;
        }


        if (
            !groups.has(
                creatorKey
            )
        ) {

            groups.set(
                creatorKey,
                []
            );
        }


        groups
            .get(creatorKey)
            .push(item);
    }


    // ========================================================
    // ROUND-ROBIN
    // ========================================================

    const creatorGroups =
        Array.from(
            groups.values()
        );


    const result = [];

    let round = 0;


    while (
        result.length < safeLimit
    ) {

        let addedThisRound =
            false;


        for (
            const creatorItems
            of creatorGroups
        ) {

            const item =
                creatorItems[round];


            if (!item) {
                continue;
            }


            result.push(
                item
            );


            addedThisRound =
                true;


            if (
                result.length >=
                safeLimit
            ) {
                break;
            }
        }


        if (!addedThisRound) {
            break;
        }


        round++;
    }


    return result;
}


// ============================================================
// FETCH MASTODON VLOGS
// ============================================================

async function fetchMastodonVlogs(
    countryCode,
    requestedLimit,
    encodedCursor = null
) {

    const country =
        String(
            countryCode ||
            "GLOBAL"
        )
            .trim()
            .toUpperCase();


    const limit =
        Math.min(
            Math.max(
                Number(
                    requestedLimit
                ) || 10,
                1
            ),
            30
        );


    const host =
        "mastodon.social";


    const hashtags =
        getMastodonHashtags(
            country
        );


    // ========================================================
    // DECODE OUR PAGINATION STATE
    // ========================================================

    const decodedState =
        decodeMastodonCursor(
            encodedCursor
        );


    /*
     * Cursor structure:
     *
     * {
     *     cursors: {
     *         india: "115...",
     *         vlog: "115...",
     *         travel: "115..."
     *     },
     *
     *     seen: [
     *         "https://...",
     *         "https://..."
     *     ]
     * }
     */


    const cursorMap =
        decodedState &&
        typeof decodedState === "object" &&
        !Array.isArray(decodedState) &&
        decodedState.cursors &&
        typeof decodedState.cursors === "object" &&
        !Array.isArray(decodedState.cursors)
            ? decodedState.cursors
            : {};


    const previouslyReturned =
        new Set(
            decodedState &&
            typeof decodedState === "object" &&
            !Array.isArray(decodedState) &&
            Array.isArray(decodedState.seen)
                ? decodedState.seen
                    .map(
                        id =>
                            cleanText(id)
                    )
                    .filter(Boolean)
                : []
        );


    const firstPage =
        !encodedCursor;


    console.log(
        `🐘 MASTODON START` +
        ` | country=${country}` +
        ` | limit=${limit}` +
        ` | page=${firstPage ? "FIRST" : "CONTINUE"}` +
        ` | activeCursors=${Object.keys(cursorMap).length}` +
        ` | previouslyReturned=${previouslyReturned.size}` +
        ` | tags=${hashtags.join(",")}`
    );


    // ========================================================
    // BUILD REQUESTS
    // ========================================================

    const requestTags = [];


    for (
        const hashtag
        of hashtags
    ) {

        /*
         * On later pages an exhausted hashtag must NOT restart
         * from page 1.
         */
        if (
            !firstPage &&
            !Object.prototype.hasOwnProperty.call(
                cursorMap,
                hashtag
            )
        ) {

            console.log(
                `⏭️ MASTODON TAG EXHAUSTED` +
                ` | tag=${hashtag}`
            );

            continue;
        }


        requestTags.push(
            hashtag
        );
    }


    // ========================================================
    // PARALLEL HASHTAG REQUESTS
    // ========================================================

    const responses =
        await Promise.all(
            requestTags.map(
                hashtag =>
                    fetchMastodonHashtag(
                        host,
                        hashtag,
                        firstPage
                            ? null
                            : cursorMap[hashtag]
                    )
            )
        );


    // ========================================================
    // BUILD NEXT PER-HASHTAG CURSORS
    // ========================================================

    const nextCursorMap = {};


    let authRestrictedInstances =
        0;

    let searchesSuccessful =
        0;


    for (
        const result
        of responses
    ) {

        if (
            result.authRequired
        ) {

            authRestrictedInstances++;
        }


        if (
            result.status >= 200 &&
            result.status < 300
        ) {

            searchesSuccessful++;
        }


        /*
         * Only keep a hashtag active if its own cursor
         * actually moved.
         */
        if (
            result.status >= 200 &&
            result.status < 300 &&
            result.hasMore &&
            result.nextMaxId
        ) {

            nextCursorMap[
                result.hashtag
            ] =
                result.nextMaxId;
        }
    }


    // ========================================================
    // COMBINE ALL STATUSES
    // ========================================================

    const allStatuses =
        responses.flatMap(
            result =>
                Array.isArray(
                    result.statuses
                )
                    ? result.statuses
                    : []
        );


    console.log(
        `🐘 MASTODON RAW` +
        ` | statuses=${allStatuses.length}`
    );


    // ========================================================
    // DEDUPE
    // ========================================================

    const uniqueMap =
        new Map();


    let oldPageDuplicates =
        0;

    let samePageDuplicates =
        0;


    for (
        const status
        of allStatuses
    ) {

        if (!status?.id) {
            continue;
        }


        /*
         * URI is preferable because same post may occur under
         * several hashtags.
         */
        const key =
            cleanText(
                status?.uri
            ) ||
            cleanText(
                status?.url
            ) ||
            cleanText(
                status?.id
            );


        if (!key) {
            continue;
        }


        // ----------------------------------------------------
        // PREVIOUS PAGE
        // ----------------------------------------------------

        if (
            previouslyReturned.has(
                key
            )
        ) {

            oldPageDuplicates++;

            console.log(
                `♻️ MASTODON OLD PAGE SKIP` +
                ` | id=${status?.id || "unknown"}`
            );

            continue;
        }


        // ----------------------------------------------------
        // CURRENT PAGE
        // ----------------------------------------------------

        if (
            uniqueMap.has(
                key
            )
        ) {

            samePageDuplicates++;

            continue;
        }


        uniqueMap.set(
            key,
            status
        );
    }


    const uniqueStatuses =
        Array.from(
            uniqueMap.values()
        );


    console.log(
        `🐘 MASTODON UNIQUE` +
        ` | statuses=${uniqueStatuses.length}` +
        ` | oldDuplicates=${oldPageDuplicates}` +
        ` | samePageDuplicates=${samePageDuplicates}`
    );


    // ========================================================
    // PROCESS STATUSES
    // ========================================================

    const candidates = [];


    let videoStatuses = 0;

    let vlogPassed = 0;

    let commercialBlocked = 0;

    let hardBlocked = 0;

    let lowVlogScore = 0;

    let sensitiveBlocked = 0;

    let botsBlocked = 0;


    for (
        const status
        of uniqueStatuses
    ) {

        try {

            // =================================================
            // SENSITIVE
            // =================================================

            if (
                status?.sensitive === true
            ) {

                sensitiveBlocked++;

                continue;
            }


            // =================================================
            // BOT
            // =================================================

            if (
                status?.account?.bot === true
            ) {

                botsBlocked++;

                continue;
            }


            // =================================================
            // VIDEO
            // =================================================

            const attachments =
                Array.isArray(
                    status?.media_attachments
                )
                    ? status.media_attachments
                    : [];


            const video =
                attachments.find(
                    media => {

                        const type =
                            String(
                                media?.type ||
                                ""
                            )
                                .toLowerCase();


                        return (
                            type === "video" &&
                            (
                                media?.url ||
                                media?.remote_url
                            )
                        );
                    }
                );


            if (!video) {
                continue;
            }


            videoStatuses++;


            // =================================================
            // TEXT
            // =================================================

            const description =
                stripHtml(
                    status?.content ||
                    ""
                );


            const mediaDescription =
                cleanText(
                    video?.description
                );


            const accountNote =
                stripHtml(
                    status?.account?.note ||
                    ""
                );


            const tags =
                Array.isArray(
                    status?.tags
                )
                    ? status.tags
                        .map(
                            tag =>
                                cleanText(
                                    tag?.name
                                )
                        )
                        .filter(Boolean)
                    : [];


            const postText =
                [
                    description,
                    mediaDescription,
                    tags.join(" ")
                ]
                    .filter(Boolean)
                    .join(" ")
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();


            const moderationText =
                [
                    description,
                    mediaDescription,
                    accountNote,
                    tags.join(" ")
                ]
                    .filter(Boolean)
                    .join(" ")
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();


            // =================================================
            // HARD BLOCK
            // =================================================

            if (
                containsMastodonHardBlock(
                    moderationText
                )
            ) {

                hardBlocked++;


                console.log(
                    `🚫 MASTODON HARD BLOCK` +
                    ` | id=${status?.id || "unknown"}` +
                    ` | creator=${cleanText(status?.account?.display_name)}` +
                    ` | tags=${tags.join(",")}` +
                    ` | text=${description.substring(0, 200)}`
                );


                continue;
            }


            // =================================================
            // COMMERCIAL
            // =================================================

            const commercialScore =
                getMastodonCommercialScore(
                    moderationText
                );


            if (
                commercialScore >= 4
            ) {

                commercialBlocked++;


                console.log(
                    `🚫 MASTODON COMMERCIAL BLOCK` +
                    ` | id=${status?.id || "unknown"}` +
                    ` | score=${commercialScore}` +
                    ` | creator=${cleanText(status?.account?.display_name)}` +
                    ` | tags=${tags.join(",")}` +
                    ` | text=${description.substring(0, 200)}`
                );


                continue;
            }


            // =================================================
            // VLOG SCORE
            // =================================================

            const vlogScore =
                calculateMastodonVlogScore(
                    postText,
                    tags
                );


            if (
                vlogScore < 40
            ) {

                lowVlogScore++;


                console.log(
                    `📉 MASTODON LOW VLOG` +
                    ` | id=${status?.id || "unknown"}` +
                    ` | score=${vlogScore}` +
                    ` | creator=${cleanText(status?.account?.display_name)}` +
                    ` | tags=${tags.join(",")}` +
                    ` | text=${postText.substring(0, 300)}`
                );


                continue;
            }


            vlogPassed++;


            // =================================================
            // LANGUAGE
            // =================================================

            const detectedLanguage =
                normalizeMastodonLanguage(
                    status?.language
                );


            // =================================================
            // COUNTRY
            // =================================================

            const countryConfidence =
                calculateMastodonCountryScore(
                    country,
                    [
                        description,
                        mediaDescription,
                        accountNote
                    ]
                        .filter(Boolean)
                        .join(" "),
                    status?.language,
                    tags
                );


            // =================================================
            // ENGAGEMENT
            // =================================================

            const likes =
                safeNumber(
                    status?.favourites_count
                );


            const comments =
                safeNumber(
                    status?.replies_count
                );


            const shares =
                safeNumber(
                    status?.reblogs_count
                );


            const engagementScore =
                likes +
                (comments * 2) +
                (shares * 3);


            // =================================================
            // CREATOR
            // =================================================

            const creatorName =
                cleanText(
                    status?.account
                        ?.display_name
                ) ||
                cleanText(
                    status?.account
                        ?.username
                ) ||
                "Mastodon";


            const creatorId =
                cleanText(
                    status?.account
                        ?.acct
                ) ||
                cleanText(
                    status?.account
                        ?.id
                );


            // =================================================
            // VIDEO URL
            // =================================================

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
                ) ||
                null;


            // =================================================
            // ID
            // =================================================

            const statusId =
                cleanText(
                    status?.id
                );


            if (!statusId) {
                continue;
            }


            const originalPostUrl =
                cleanText(
                    status?.url
                ) ||
                cleanText(
                    status?.uri
                ) ||
                null;


            // =================================================
            // CANDIDATE
            // =================================================

            candidates.push({

                uniqueId:
                    `mastodon_${statusId}`,

                /*
                 * Internal pagination/dedupe key.
                 * API response can contain it; Android can
                 * simply ignore unknown fields if not modeled.
                 */
                paginationKey:
                    cleanText(
                        status?.uri
                    ) ||
                    cleanText(
                        status?.url
                    ) ||
                    statusId,

                provider:
                    "mastodon",

                videoUrl,

                thumbnailUrl,

                originalPostUrl,

                title:
                    description
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim()
                        .slice(
                            0,
                            180
                        ),

                description:
                    postText
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim()
                        .slice(
                            0,
                            1000
                        ),

                creatorId,

                creatorName,

                creatorAvatar:
                    cleanText(
                        status?.account
                            ?.avatar
                    ) ||
                    null,

                language:
                    detectedLanguage,

                detectedCountry:
                    countryConfidence >= 60
                        ? country
                        : null,

                views:
                    0,

                likes,

                comments,

                shares,

                publishedAt:
                    status?.created_at
                        ? (
                            Date.parse(
                                status.created_at
                            ) || 0
                        )
                        : 0,

                countryConfidence:
                    Math.min(
                        Math.max(
                            countryConfidence,
                            0
                        ),
                        100
                    ),

                vlogScore:
                    Math.min(
                        Math.max(
                            vlogScore,
                            0
                        ),
                        100
                    ),

                engagementScore
            });


        } catch (error) {

            console.log(
                `🐘 MASTODON STATUS SKIP` +
                ` | id=${status?.id || "unknown"}` +
                ` | error=${error?.message || "unknown"}`
            );
        }
    }


    // ========================================================
    // SORT
    // ========================================================

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


    // ========================================================
    // TIERS
    // ========================================================

    // const strongCountry =
    //     candidates.filter(
    //         item =>
    //             item.countryConfidence >= 70
    //     );


    // const possibleCountry =
    //     candidates.filter(
    //         item =>
    //             item.countryConfidence >= 35 &&
    //             item.countryConfidence < 70
    //     );

const strongCountry =
    candidates.filter(
        item =>
            item.countryConfidence >= 60
    );


const possibleCountry =
    candidates.filter(
        item =>
            item.countryConfidence >= 35 &&
            item.countryConfidence < 60
    );


const weakCountry =
    candidates.filter(
        item =>
            item.countryConfidence < 35
    );


// ========================================================
// LOCAL-FIRST / GLOBAL-FALLBACK GATE
//
// Country request:
//     STRONG + POSSIBLE only.
//
// GLOBAL request:
//     all valid vlog candidates.
//
// IMPORTANT:
// Global fallback yahan country response ke andar mix
// nahi hoga. Android discovery manager GLOBAL request
// separately karega when local supply is low.
// ========================================================

const isGlobalRequest =
    country === "GLOBAL";


const rankedByCountry =
    isGlobalRequest
        ? candidates
        : [
            ...strongCountry,
            ...possibleCountry
        ];


console.log(
    `🌍 MASTODON COUNTRY GATE` +
    ` | country=${country}` +
    ` | strong=${strongCountry.length}` +
    ` | possible=${possibleCountry.length}` +
    ` | weak=${weakCountry.length}` +
    ` | eligible=${rankedByCountry.length}` +
    ` | weakAllowed=${isGlobalRequest}`
);


const videos =
    diversifyByCreator(
        rankedByCountry,
        limit,

        item =>
            item?.creatorId ||
            item?.creatorName ||
            ""
    );

    const finalCreatorCount =
    new Set(
        videos
            .map(
                item =>
                    cleanText(
                        item?.creatorId ||
                        item?.creatorName
                    )
                        .toLowerCase()
            )
            .filter(Boolean)
    ).size;


console.log(
    `🐘 MASTODON DIVERSITY` +
    ` | candidates=${rankedByCountry.length}` +
    ` | returned=${videos.length}` +
    ` | creators=${finalCreatorCount}`
);


    // ========================================================
    // SEEN STATE
    // ========================================================

    /*
     * IMPORTANT:
     * Only videos ACTUALLY returned to Android are remembered.
     */

    const returnedKeys =
        videos
            .map(
                item =>
                    cleanText(
                        item?.paginationKey
                    )
            )
            .filter(Boolean);


    const seenForNextPage =
        [
            ...previouslyReturned,
            ...returnedKeys
        ]
            .filter(
                (
                    value,
                    index,
                    array
                ) =>
                    array.indexOf(value) ===
                    index
            )
            .slice(-200);


    // Remove internal field before response.
    for (
        const item
        of videos
    ) {

        delete item.paginationKey;
    }


    // ========================================================
    // NEXT CURSOR
    // ========================================================

    const hasMore =
        Object.keys(
            nextCursorMap
        ).length > 0;


    const nextCursor =
        hasMore
            ? encodeMastodonCursor({
                cursors:
                    nextCursorMap,

                seen:
                    seenForNextPage
            })
            : null;


    // ========================================================
    // DEBUG
    // ========================================================

    const debug = {

        instancesAttempted:
            1,

        hashtagsAttempted:
            requestTags.length,

        hashtagsSuccessful:
            searchesSuccessful,

        hashtags,

        activeHashtags:
            Object.keys(
                nextCursorMap
            ).length,

        authRestrictedInstances,

        statusesReceived:
            allStatuses.length,

        uniqueStatuses:
            uniqueStatuses.length,

        oldPageDuplicates,

        samePageDuplicates,

        videoStatuses,

        vlogPassed,

        candidates:
            candidates.length,

        commercialBlocked,

        hardBlocked,

        lowVlogScore,

        sensitiveBlocked,

        botsBlocked
    };


    const tiers = {

        strongCountry:
            strongCountry.length,

        possibleCountry:
            possibleCountry.length,

        weakCountry:
            weakCountry.length
    };


    // ========================================================
    // FINAL LOG
    // ========================================================

    console.log(
        `🐘 MASTODON DONE` +
        ` | country=${country}` +
        ` | page=${firstPage ? "FIRST" : "CONTINUE"}` +
        ` | attempted=${requestTags.length}` +
        ` | successful=${searchesSuccessful}` +
        ` | raw=${allStatuses.length}` +
        ` | unique=${uniqueStatuses.length}` +
        ` | video=${videoStatuses}` +
        ` | vlogPassed=${vlogPassed}` +
        ` | candidates=${candidates.length}` +
        ` | returned=${videos.length}` +
        ` | remembered=${seenForNextPage.length}` +
        ` | hasMore=${hasMore}` +
        ` | activeHashtags=${Object.keys(nextCursorMap).length}`
    );


    return {

        videos,

        debug,

        tiers,

        nextCursor,

        hasMore
    };
}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            const startedAt =
                Date.now();


            try {

                const requestUrl =
                    new URL(
                        req.url,
                        `http://${req.headers.host || "localhost"}`
                    );


                const pathname =
                    requestUrl.pathname;


                // =================================================
                // CORS PREFLIGHT
                // =================================================

                if (
                    req.method ===
                    "OPTIONS"
                ) {

                    res.writeHead(
                        204,
                        {
                            "Access-Control-Allow-Origin":
                                "*",

                            "Access-Control-Allow-Methods":
                                "GET, OPTIONS",

                            "Access-Control-Allow-Headers":
                                "Content-Type, Authorization",

                            "Access-Control-Max-Age":
                                "86400"
                        }
                    );

                    res.end();

                    return;
                }


                // =================================================
                // HOME
                // =================================================

                if (
                    req.method ===
                        "GET" &&
                    pathname ===
                        "/"
                ) {

                    sendJson(
                        res,
                        200,
                        {

                            status:
                                "ok",

                            service:
                                "Vlogger Social Video API",

                            providers: [
                                "bluesky",
                                "mastodon"
                            ],

                            endpoints: {

                                health:
                                    "/health",

                                bluesky:
                                    "/api/bluesky/vlogs?country=IN&limit=10",

                                mastodon:
                                    "/api/mastodon/vlogs?country=IN&limit=10",
                                blueskyfeed:
                                    "/test/bluesky-video-feed"
                            }
                        }
                    );

                    return;
                }


                // =================================================
                // HEALTH
                // =================================================

                if (
                    req.method ===
                        "GET" &&
                    pathname ===
                        "/health"
                ) {

                    sendJson(
                        res,
                        200,
                        {
    status:
        "ok",

    service:
        "vlogger-social-api",

    blueskyMode:
        "public",

    mastodonConfigured:
        Boolean(
            MASTODON_ACCESS_TOKEN
        ),

    timestamp:
        new Date()
            .toISOString()
}
                    );

                    return;
                }

                // =================================================
// TEST BLUESKY VIDEO FEED
// =================================================

if (
    req.method === "GET" &&
    pathname === "/test/bluesky-video-feed"
) {

    console.log(
        "🧪 TESTING BLUESKY VIDEO FEED"
    );


    const result =
        await fetchBlueskyVideoFeed(
            null,
            20
        );


    sendJson(
        res,
        200,
        {
            status:
                "success",

            received:
                result.posts.length,

            hasMore:
                result.hasMore,

            cursor:
                result.cursor,

            videos:
                result.posts.map(
                    post => ({
                        uri:
                            post?.uri || null,

                        creator:
                            post?.author?.handle || null,

                        text:
                            post?.record?.text || "",

                        hasPlayableVideo:
                            Boolean(
                                extractVideo(post)
                            )
                    })
                )
        }
    );


    return;
}


                // =================================================
                // BLUESKY VLOGS
                // =================================================

                if (
                    req.method ===
                        "GET" &&
                    pathname ===
                        "/api/bluesky/vlogs"
                ) {

                    /*
                     * IMPORTANT:
                     *
                     * IN sirf example URL me hai.
                     * Actual Android country dynamic
                     * query parameter se aata hai.
                     */

                    const rawCountry =
                        cleanText(
                            requestUrl
                                .searchParams
                                .get(
                                    "country"
                                )
                        );


                   const normalizedCountry =
    cleanText(rawCountry)
        .toUpperCase();

const country =
    normalizedCountry === "GLOBAL"
        ? "GLOBAL"
        : (
            /^[A-Z]{2}$/.test(normalizedCountry)
                ? normalizedCountry
                : "GLOBAL"
        );

                    const requestedLimit =
                        Math.min(
                            Math.max(
                                Number(
                                    requestUrl
                                        .searchParams
                                        .get(
                                            "limit"
                                        )
                                ) || 10,
                                1
                            ),
                            MAX_OUTPUT_LIMIT
                        );

                    const cursor =
    cleanText(
        requestUrl
            .searchParams
            .get(
                "cursor"
            )
    ) || null;


                    console.log(
                        `🦋 API BLUESKY` +
                        ` | country=${country}` +
                        ` | limit=${requestedLimit}`
                    );


                    const result =
    await fetchBlueskyVlogs(
        country,
        requestedLimit,
        cursor
    );


                    sendJson(
    res,
    200,
    {

        status:
            "success",

        provider:
            "bluesky",

        country,

        requested:
            requestedLimit,

        returned:
            result.videos.length,

        timeMs:
            Date.now() -
            startedAt,

        debug:
            result.debug,

        tiers:
            result.tiers,

        // =============================================
        // PAGINATION
        // =============================================

        nextCursor:
            result.nextCursor,

        hasMore:
            result.hasMore,

        // =============================================
        // VIDEOS
        // =============================================

        videos:
            result.videos
                .map(
                    item => ({

                        uniqueId:
                            item.id,

                        provider:
                            "bluesky",

                        videoUrl:
                            item.videoUrl,

                        thumbnailUrl:
                            item.thumbnailUrl,

                        originalPostUrl:
                            item.originalPostUrl,

                        title:
                            item.caption,

                        description:
                            item.caption,

                        creatorId:
                            item.creatorId,

                        creatorName:
                            item.creatorName,

                        creatorAvatar:
                            item.creatorAvatar,

                        language:
                            item.language,

                        detectedCountry:
                            item.countryScore >= 60
                                ? country
                                : null,

                        views:
                            0,

                        likes:
                            item.likes,

                        comments:
                            item.comments,

                        shares:
                            item.shares,

                        publishedAt:
                            item.indexedAt
                                ? (
                                    Date.parse(
                                        item.indexedAt
                                    ) || 0
                                )
                                : 0,

                        countryConfidence:
                            item.countryScore,

                        vlogScore:
                            item.vlogScore,

                        engagementScore:
                            item.engagementScore
                    })
                )
    }
);
                


                    return;
                }


                // =================================================
                // MASTODON VLOGS
                // =================================================

                if (
                    req.method ===
                        "GET" &&
                    pathname ===
                        "/api/mastodon/vlogs"
                ) {

                    const rawCountry =
                        cleanText(
                            requestUrl
                                .searchParams
                                .get(
                                    "country"
                                )
                        );


                    /*
                     * IMPORTANT:
                     *
                     * Do NOT do:
                     *
                     * (rawCountry || "GLOBAL")
                     *     .slice(0,2)
                     *
                     * because GLOBAL becomes "GL".
                     */

                    const normalizedCountry =
    cleanText(rawCountry)
        .toUpperCase();

const country =
    normalizedCountry === "GLOBAL"
        ? "GLOBAL"
        : (
            /^[A-Z]{2}$/.test(normalizedCountry)
                ? normalizedCountry
                : "GLOBAL"
        );


                    const requestedLimit =
                        Math.min(
                            Math.max(
                                Number(
                                    requestUrl
                                        .searchParams
                                        .get(
                                            "limit"
                                        )
                                ) || 10,
                                1
                            ),
                            30
                        );

                    const cursor =
    cleanText(
        requestUrl
            .searchParams
            .get("cursor")
    ) || null;

                    console.log(
                        `🐘 API MASTODON` +
                        ` | country=${country}` +
                        ` | limit=${requestedLimit}`
                    );


                   const result =
    await fetchMastodonVlogs(
        country,
        requestedLimit,
        cursor
    );

                    /*
                     * FIX:
                     *
                     * fetchMastodonVlogs returns:
                     *
                     * {
                     *   videos,
                     *   debug,
                     *   tiers
                     * }
                     *
                     * So response must use
                     * result.debug and result.tiers.
                     */

                    sendJson(
    res,
    200,
    {
        status:
            "success",

        provider:
            "mastodon",

        country,

        requested:
            requestedLimit,

        returned:
            result.videos.length,

        timeMs:
            Date.now() -
            startedAt,

        debug:
            result.debug,

        tiers:
            result.tiers,

        nextCursor:
            result.nextCursor,

        hasMore:
            result.hasMore,

        videos:
            result.videos.map(
                item => ({
                    uniqueId:
                        item.uniqueId,

                    provider:
                        "mastodon",

                    videoUrl:
                        item.videoUrl,

                    thumbnailUrl:
                        item.thumbnailUrl,

                    originalPostUrl:
                        item.originalPostUrl,

                    title:
                        item.title,

                    description:
                        item.description,

                    creatorId:
                        item.creatorId,

                    creatorName:
                        item.creatorName,

                    creatorAvatar:
                        item.creatorAvatar,

                    language:
                        item.language,

                    detectedCountry:
                        item.detectedCountry,

                    views:
                        item.views,

                    likes:
                        item.likes,

                    comments:
                        item.comments,

                    shares:
                        item.shares,

                    publishedAt:
                        item.publishedAt,

                    countryConfidence:
                        item.countryConfidence,

                    vlogScore:
                        item.vlogScore,

                    engagementScore:
                        item.engagementScore
                })
            )
    }
);


                    return;
                }


                // =================================================
                // NOT FOUND
                // =================================================

                sendJson(
                    res,
                    404,
                    {

                        status:
                            "error",

                        error:
                            "Not found",

                        path:
                            pathname
                    }
                );


            } catch (error) {

                console.error(
                    "❌ SERVER ERROR",
                    error
                );


                sendJson(
                    res,
                    500,
                    {

                        status:
                            "error",

                        error:
                            error?.message ||
                            "Internal server error"
                    }
                );
            }
        }
    );


// ============================================================
// START SERVER
// ============================================================

server.listen(
    PORT,
    () => {

        console.log(
            `🚀 Vlogger Social Video API running on port ${PORT}`
        );

        console.log(
    "🦋 Bluesky mode=PUBLIC"
);

        console.log(
            `🐘 Mastodon configured=${Boolean(
                MASTODON_ACCESS_TOKEN
            )}`
        );
    }
);
