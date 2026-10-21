const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // Home
    if (req.url === "/" || req.url === "") {
        res.writeHead(200);

        return res.end(JSON.stringify({
            status: "Vlogger Bluesky Test Server Running",
            test: "/test-bluesky"
        }, null, 2));
    }

    // Bluesky Test
    if (req.url.startsWith("/test-bluesky")) {

        const blueskyUrl =
            "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts" +
            "?q=india&sort=top&limit=5";

        try {

            console.log("Testing Bluesky...");
            console.log(blueskyUrl);

            const response = await fetch(blueskyUrl, {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Vlogger-Bluesky-Test/1.0"
                }
            });

            const body = await response.text();

            console.log("Bluesky HTTP Status:", response.status);

            if (!response.ok) {

                console.log("Bluesky Error:", body);

                res.writeHead(200);

                return res.end(JSON.stringify({
                    bluesky: "FAILED",
                    status: response.status,
                    contentType: response.headers.get("content-type"),
                    response: body.substring(0, 1000)
                }, null, 2));
            }

            let data;

            try {
                data = JSON.parse(body);
            } catch (error) {

                res.writeHead(200);

                return res.end(JSON.stringify({
                    bluesky: "INVALID_RESPONSE",
                    status: response.status,
                    response: body.substring(0, 1000)
                }, null, 2));
            }

            const posts = Array.isArray(data.posts)
                ? data.posts
                : [];

            res.writeHead(200);

            return res.end(JSON.stringify({
                bluesky: "WORKING",
                status: response.status,
                postsFound: posts.length,

                posts: posts.map(post => ({
                    uri: post.uri || null,
                    author: post.author?.handle || null,
                    text: post.record?.text || null,
                    hasEmbed: !!post.embed
                }))
            }, null, 2));

        } catch (error) {

            console.error("Bluesky Test Exception:", error);

            res.writeHead(200);

            return res.end(JSON.stringify({
                bluesky: "EXCEPTION",
                error: error.message
            }, null, 2));
        }
    }

    res.writeHead(404);

    return res.end(JSON.stringify({
        error: "Not Found"
    }));
});

server.listen(PORT, () => {
    console.log(`Vlogger Bluesky Test Server running on port ${PORT}`);
});
