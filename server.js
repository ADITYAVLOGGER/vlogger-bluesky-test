const http = require("http");

const PORT = process.env.PORT || 3000;

function sendJson(res, data) {
    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {

    if (req.url === "/" || req.url === "") {
        return sendJson(res, {
            status: "Vlogger Bluesky Auth Test Server Running",
            test: "/test-bluesky-auth"
        });
    }

    if (req.url.startsWith("/test-bluesky-auth")) {

        const identifier = process.env.BSKY_IDENTIFIER;
        const password = process.env.BSKY_PASSWORD;

        if (!identifier || !password) {
            return sendJson(res, {
                bluesky: "CONFIG_ERROR",
                message: "BSKY_IDENTIFIER or BSKY_PASSWORD missing"
            });
        }

        try {

            // =========================================
            // STEP 1: LOGIN TO BLUESKY PDS
            // =========================================

            console.log("🔐 Logging into Bluesky...");

            const loginResponse = await fetch(
                "https://bsky.social/xrpc/com.atproto.server.createSession",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "User-Agent": "Vlogger-Bluesky-Test/1.0"
                    },

                    body: JSON.stringify({
                        identifier: identifier,
                        password: password
                    })
                }
            );

            const loginText = await loginResponse.text();

            console.log(
                "Bluesky Login Status:",
                loginResponse.status
            );

            if (!loginResponse.ok) {

                return sendJson(res, {
                    bluesky: "LOGIN_FAILED",
                    loginStatus: loginResponse.status,
                    contentType:
                        loginResponse.headers.get("content-type"),
                    response:
                        loginText.substring(0, 1000)
                });
            }

            let session;

            try {
                session = JSON.parse(loginText);
            } catch (e) {
                return sendJson(res, {
                    bluesky: "LOGIN_INVALID_JSON",
                    loginStatus: loginResponse.status,
                    response:
                        loginText.substring(0, 1000)
                });
            }

            const accessJwt = session.accessJwt;

            if (!accessJwt) {
                return sendJson(res, {
                    bluesky: "NO_ACCESS_TOKEN",
                    loginStatus: loginResponse.status
                });
            }

            console.log("✅ Bluesky login successful");

            // =========================================
            // STEP 2: AUTHENTICATED SEARCH
            // IMPORTANT:
            // Use user's PDS, NOT public.api.bsky.app
            // =========================================

            const searchUrl =
                "https://bsky.social/xrpc/" +
                "app.bsky.feed.searchPosts" +
                "?q=india" +
                "&sort=top" +
                "&limit=5";

            console.log("🔎 Testing authenticated search...");

            const searchResponse = await fetch(
                searchUrl,
                {
                    method: "GET",

                    headers: {
                        "Authorization":
                            `Bearer ${accessJwt}`,

                        "Accept":
                            "application/json",

                        "User-Agent":
                            "Vlogger-Bluesky-Test/1.0"
                    }
                }
            );

            const searchText =
                await searchResponse.text();

            console.log(
                "Authenticated Search Status:",
                searchResponse.status
            );

            if (!searchResponse.ok) {

                return sendJson(res, {
                    bluesky: "AUTH_SEARCH_FAILED",

                    loginStatus:
                        loginResponse.status,

                    loginWorking: true,

                    searchStatus:
                        searchResponse.status,

                    contentType:
                        searchResponse.headers.get(
                            "content-type"
                        ),

                    response:
                        searchText.substring(0, 1500)
                });
            }

            let searchData;

            try {
                searchData =
                    JSON.parse(searchText);
            } catch (e) {

                return sendJson(res, {
                    bluesky:
                        "SEARCH_INVALID_JSON",

                    searchStatus:
                        searchResponse.status,

                    response:
                        searchText.substring(0, 1500)
                });
            }

            const posts =
                Array.isArray(searchData.posts)
                    ? searchData.posts
                    : [];

            // =========================================
            // SUCCESS
            // =========================================

            return sendJson(res, {

                bluesky:
                    "AUTHENTICATED_WORKING",

                loginStatus:
                    loginResponse.status,

                searchStatus:
                    searchResponse.status,

                handle:
                    session.handle || null,

                did:
                    session.did || null,

                postsFound:
                    posts.length,

                posts:
                    posts.map(post => ({

                        uri:
                            post.uri || null,

                        author:
                            post.author?.handle || null,

                        text:
                            post.record?.text || null,

                        hasEmbed:
                            !!post.embed

                    }))
            });

        } catch (error) {

            console.error(
                "Bluesky Auth Test Exception:",
                error
            );

            return sendJson(res, {
                bluesky: "EXCEPTION",
                error: error.message
            });
        }
    }

    return sendJson(res, {
        error: "Not Found",
        available: [
            "/test-bluesky-auth"
        ]
    });
});

server.listen(PORT, () => {

    console.log(
        `Vlogger Bluesky Auth Test running on port ${PORT}`
    );

});
