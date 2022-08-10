/**
 * @file Handle primary worker function
 * @name index.ts
 * @author 0aoq <hkau@oxvs.net>
 * @license MIT
 */

// @ts-ignore
import missinghost from "./missinghost.html"

export interface Env {}

addEventListener("fetch", event => {
	event.respondWith(handleRequest(event.request))
})

/**
 * @function getParams
 * @description Return the URLSearchParams for a URL
 * 
 * @param {string} _url URL to get the search params from
 * @returns {any} params object
 */
function getParams(_url: string): any {
	const params = {} as any
	const url = new URL(_url)
	const queryString = url.search.slice(1).split('&')

	for (let item of queryString) {
		const kv = item.split('=') as string[]
		if (kv[0]) params[kv[0]] = kv[1] || true
	}

	return params
}

/**
 * @function resolveCookieOPHOST
 * @description Get the OPHOST from a browser cookie
 * 
 * @param {Request} request
 * @returns {string | undefined}
 */
function resolveCookieOPHOST(request: Request) {
	const cookieHeader = request.headers.get("cookie")
	if (!cookieHeader) return undefined
	if (!cookieHeader.split("ophost=")[1]) return undefined
	return cookieHeader.split("ophost=")[1].split(";")[0]
}

/**
 * @function handleRequest
 * @description Handle a request to the worker
 * 
 * @param {Request} request 
 * @returns {Promise<Response>}
 */
async function handleRequest(request: Request): Promise<Response> {
	const worker_url = "resolve.oxvs.net" // CHANGE THIS BEFORE DEPLOY, WILL BE USED FOR FINDING SERVICEWORKER AND OTHER CONTENT
	const url = new URL(request.url)

	const params = getParams(request.url)
	const refParams = getParams(request.headers.get("Referer") || request.url)
	const cookieHost = resolveCookieOPHOST(request)

	if (
		// make sure we have a valid ophost before proceeding
		!params["ophost"]
		&& !refParams["ophost"]
		&& !cookieHost
	) return new Response(missinghost, { status: 400, headers: { "content-type": "text/html" } })

	const target = params["ophost"] || refParams["ophost"] || cookieHost
	url.hostname = target

	if (url.pathname === "/.sw.httpsw") {
		return new Response(`// generated ${new Date().toISOString()}
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

async function handleRequest(request) {
	// intercept http traffic and append the ophost
	let newurl = new URL(request.url)

	const _params = {
		"ophost": newurl.hostname // fetch it from the other server
	}

	newurl = new URL(
		\`\${newurl.origin}\${newurl.pathname}?\${new URLSearchParams([
			...Array.from(newurl.searchParams.entries()),
			...Object.entries(_params),
		]).toString()}\`
	)

	newurl.hostname = "${worker_url}"

	let req = new Request(newurl.href, {
		"headers": {
			"referer": "https://${worker_url}/?ophost=${target}",
			"x-sw-intercept": "true; https://${worker_url}/.sw.httpsw/",
			"x-renav": "https://${worker_url}/.navigate"
		}
	})

	return fetch(newurl, req)
}

self.addEventListener('fetch', function (event) {
	if (new URL(event.request.url).hostname === "${worker_url}") return // requesting an already proxied service
    event.respondWith(handleRequest(event.request))
})`, {
			"headers": {
				"content-type": "text/javascript;charset=UTF-8",
			},
			"status": 200
		})
	} else if (url.pathname === "/.navigate" || url.pathname === "/.nav") {
		return new Response(missinghost, { status: 200, headers: { "content-type": "text/html" } })
	}

	let initialFetchOptions = {
		"headers": {
			"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:103.0) Gecko/20100101 Firefox/103.0",
			"Referer": `https://${target}`, 
			"Origin": `https://${target}`
		},
		"method": request.method
	}

	if (initialFetchOptions.method !== "GET" && initialFetchOptions.method !== "HEAD") {
		// @ts-ignore
		initialFetchOptions.body = decodeURIComponent(await request.text())
	}

	const data = await fetch(url.href, initialFetchOptions)

	let req = new Request(url.href, {
		// @ts-ignore
		"headers": new Headers({
			"Content-Type": data.headers.get("Content-Type"),
			"Referer": `https://${worker_url}/?ophost=${target}`,
			"Set-Cookie": `ophost=${target}; SameSite=Lax; Secure; HttpOnly`
		})
	})

	const ContentType: string = req.headers.get("Content-Type") as string

	let isBadContentType = ContentType.startsWith("image/") || // make sure we don't try to modify a content-type that we can't convert to text
		ContentType.startsWith("text/plain") ||
		ContentType.startsWith("application/font-") ||
		ContentType.startsWith("font/")

	if (isBadContentType) {
		return data
	} else {
		let text = await data.text()
		text = text.replaceAll(`https://${target}/`, `https://${worker_url}/`)
		text = text.replaceAll("\"></script>", `?ophost=${target}\"></script>`)
		text = text.replaceAll(".js\"", `.js?ophost=${target}\"`)
		text = text.replaceAll(".css\"", `.css?ophost=${target}\"`)

		if (ContentType.includes("text/html")) {
			if (refParams["ophost"] !== undefined && params["ophost"] === undefined) {
				// if our host url came from the ref params, add it to this page's params
				text = `<script>
                    if (window.location.href.includes("?")) {
                        window.location.href = \`\${window.location.href}&ophost=${target}\`
                    } else {
                        window.location.href = "?ophost=${target}"
                    }
                </script>`
			} else {
				text += `<script>window.localStorage.setItem("OP-HOST", "${target}")</script>`
			}

			// register a service worker to try to catch others
			text += `<script>
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('https://${worker_url}/.sw.httpsw?ophost=${target}').then((registration) => {
        console.log('[OPHOST] Service worker registered with scope: ', registration.scope)
    }, (err) => {
        console.log('[OPHOST] ServiceWorker registration failed: ', err)
    });

    (async () => {
        await navigator.serviceWorker.ready
    })();
}</script>`
		}

		return new Response(text, req)
	}
}