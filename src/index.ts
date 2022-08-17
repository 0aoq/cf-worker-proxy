/**
 * @file Handle primary worker function
 * @name index.ts
 * @author 0aoq <hkau@oxvs.net>
 * @license MIT
 */

// @ts-ignore
import missinghost from "./pages/missinghost.html";

// @ts-ignore
import injectionPage from "./pages/injection.html";

import blockList from "./blockList";

export interface Env {}

addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request));
});

/**
 * @function getParams
 * @description Return the URLSearchParams for a URL
 *
 * @param {string} _url URL to get the search params from
 * @returns {any} params object
 */
function getParams(_url: string): any {
    const params = {} as any;
    const url = new URL(_url);
    const queryString = url.search.slice(1).split("&");

    for (let item of queryString) {
        const kv = item.split("=") as string[];
        if (kv[0]) params[kv[0]] = kv[1] || true;
    }

    return params;
}

/**
 * @function resolveCookieOPHOST
 * @description Get the OPHOST from a browser cookie
 *
 * @param {Request} request
 * @returns {string | undefined}
 */
function resolveCookieOPHOST(request: Request) {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return undefined;
    if (!cookieHeader.split("ophost=")[1]) return undefined;
    return cookieHeader.split("ophost=")[1].split(";")[0];
}

/**
 * @function handleRequest
 * @description Handle a request to the worker
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // OPTIONS
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: new Headers({
                Allow: "GET, HEAD, POST, OPTIONS",
                ...request.headers,
                ...cors,
            }),
        });
    }

    // pages
    if (url.pathname === "/.navigate" || url.pathname === "/.nav") {
        return new Response(missinghost, {
            status: 200,
            headers: { "content-type": "text/html" },
        });
    } else if (url.pathname === "/.inject" || url.pathname === "/.pi") {
        return new Response(injectionPage, {
            status: 200,
            headers: { "content-type": "text/html" },
        });
    }

    // basic proxy
    const worker_url = "resolve.oxvs.net"; // CHANGE THIS BEFORE DEPLOY, WILL BE USED FOR FINDING SERVICEWORKER AND OTHER CONTENT

    const params = getParams(request.url);
    const refParams = getParams(request.headers.get("Referer") || request.url);
    const cookieHost = resolveCookieOPHOST(request);

    if (
        // make sure we have a valid ophost before proceeding
        !params["ophost"] &&
        !refParams["ophost"] &&
        !cookieHost
    )
        return new Response(missinghost, {
            status: 400,
            headers: { "content-type": "text/html" },
        });

    const target = params["ophost"] || refParams["ophost"] || cookieHost;
    url.hostname = target;

    if (url.pathname.includes("/.drop"))
        return new Response(
            `Dropped resource: ${url.href} (target: ${target})`,
            {
                status: 200,
                statusText: "Dropped resource",
            }
        );

    let initialFetchOptions = {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64; rv:103.0) Gecko/20100101 Firefox/103.0",
            Referer: `https://${target}`,
            Origin: `https://${target}`,
        },
        method: request.method,
    };

    if (
        initialFetchOptions.method !== "GET" &&
        initialFetchOptions.method !== "HEAD"
    ) {
        // @ts-ignore
        initialFetchOptions.body = decodeURIComponent(await request.text());
    }

    const data = await fetch(url.href, initialFetchOptions);

    let req = new Request(url.href, {
        // @ts-ignore
        headers: new Headers({
            "Content-Type": data.headers.get("Content-Type"),
            Referer: `https://${worker_url}/?ophost=${target}`,
            "Set-Cookie":
                url.pathname === "/" ? `ophost=${target}; SameSite=Lax;` : "",
            Via: `${worker_url} cf-worker-proxy (https://github.com/0aoq/cf-worker-proxy)`,
            "X-Renav": `https://${worker_url}/.navigate`,
            ...data.headers,
            ...cors,
        }),
    });

    const ContentType: string = req.headers.get("Content-Type") as string;

    let isBadContentType =
        ContentType.startsWith("image/") || // make sure we don't try to modify a content-type that we can't convert to text
        ContentType.startsWith("text/plain") ||
        ContentType.startsWith("application/font-") ||
        ContentType.startsWith("font/");

    if (isBadContentType) {
        return data;
    } else {
        let text = await data.text();
        text = text.replaceAll(`https://${target}/`, `https://${worker_url}/`);
        text = text.replaceAll('"></script>', `?ophost=${target}\"></script>`);
        text = text.replaceAll('.js"', `.js?ophost=${target}\"`);
        text = text.replaceAll('.css"', `.css?ophost=${target}\"`);
        text = text.replaceAll('.html"', `.html?ophost=${target}\"`);

        for (let _block_url of blockList) {
            text = text.replaceAll(_block_url, `/${worker_url}/.drop/`);
        }

        if (ContentType.includes("text/html") && text.includes("<title")) {
            if (
                (refParams["ophost"] !== undefined &&
                    params["ophost"] === undefined) ||
                (cookieHost !== undefined && params["ophost"] === undefined)
            ) {
                // if our host url came from the ref params, add it to this page's params
                text = `<script>
                    if (window.location.href.includes("?")) {
                        window.location.href = \`\${window.location.href}&ophost=${target}\`
                    } else {
                        window.location.href = "?ophost=${target}"
                    }
                </script>`;
            } else {
                text += `<script>window.localStorage.setItem("OP-HOST", "${target}")</script>`;
            }

            // inject code if given
            if (
                request.headers.get("X-Proxy-Inject") ||
                params["x-proxy-inject"] ||
                refParams["x-proxy-inject"]
            ) {
                const code =
                    request.headers.get("X-Proxy-Inject") ||
                    params["x-proxy-inject"] ||
                    refParams["x-proxy-inject"];
                text += `<script type="module">${decodeURIComponent(
                    code.replaceAll(/\+/g, " ")
                )}</script>`;
            }

            // add watermelonjs
            text += `<script defer type="module">
                // add anchor
                for (let anchor of document.querySelectorAll("a")) {
                    const aURL = new URL(anchor.href)
                    aURL.searchParams.set("ophost", "${target}")

                    anchor.href = aURL.href
                }
            </script>`
        }

        return new Response(text, req);
    }
}
