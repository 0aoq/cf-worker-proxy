# cf-worker-proxy

Very simple HTTP proxy built for Cloudflare Workers.

## Usage

The proxy will look for a URL in the `ophost` query parameter. A simple URL generator for this is given when missing an `ophost`.

If no host is found from the `ophost` query parameter it will fallback to searching the `referer` header for one, if it finally fails to find one here it will attempt to use the `ophost` from the cookie. This will only be set if the user has already navigated to a page using the `ophost` parameter before.

This will proxy *most* traffic through it, allowing you to easily block content from ever reaching the browser.

**Example**: `https://[proxy-url]/0aoq/cf-worker-proxy/?ophost=github.com`