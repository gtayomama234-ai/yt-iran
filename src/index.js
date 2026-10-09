const YOUTUBE_ORIGIN = "https://www.youtube.com";
const MOBILE_YOUTUBE_ORIGIN = "https://m.youtube.com";
const CONSENT_ORIGIN = "https://consent.youtube.com";

/* hi guys
*/

const PROXY_IMAGE_HOSTS = [
  "i.ytimg.com",
  "yt3.ggpht.com",
  "yt4.ggpht.com",
  "yt3.googleusercontent.com"
];

function isYouTubeHost(hostname) {
  return (
    hostname === "www.youtube.com" ||
    hostname === "youtube.com" ||
    hostname === "m.youtube.com"
  );
}

function isImageHost(hostname) {
  return PROXY_IMAGE_HOSTS.includes(hostname);
}

function isGoogleVideoHost(hostname) {
  return (
    hostname === "googlevideo.com" ||
    hostname.endsWith(".googlevideo.com")
  );
}

function isConsentHost(hostname) {
  return hostname === "consent.youtube.com";
}

function encodeVideoURL(value) {
  return btoa(
    unescape(
      encodeURIComponent(value)
    )
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeVideoURL(value) {
  try {
    let base64 =
      value
        .replaceAll("-", "+")
        .replaceAll("_", "/");

    while (base64.length % 4) {
      base64 += "=";
    }

    return decodeURIComponent(
      escape(
        atob(base64)
      )
    );
  } catch {
    return null;
  }
}

function rewriteURL(
  value,
  workerOrigin,
  baseOrigin = YOUTUBE_ORIGIN
) {
  if (!value) return value;

  try {
    const url =
      new URL(
        value,
        baseOrigin
      );

    /*
     * Mobile YouTube must stay on
     * the Worker under /_mobile/.
     */
    if (
      url.hostname ===
      "m.youtube.com"
    ) {
      return (
        workerOrigin +
        "/_mobile" +
        url.pathname +
        url.search +
        url.hash
      );
    }

    /*
     * Main YouTube stays on the
     * Worker root.
     */
    if (
      isYouTubeHost(
        url.hostname
      )
    ) {
      return (
        workerOrigin +
        url.pathname +
        url.search +
        url.hash
      );
    }

    /*
     * Consent requests stay on
     * the Worker under /_consent/.
     */
    if (
      isConsentHost(
        url.hostname
      )
    ) {
      return (
        workerOrigin +
        "/_consent" +
        url.pathname +
        url.search +
        url.hash
      );
    }

    /*
     * Proxy image requests.
     */
    if (
      isImageHost(
        url.hostname
      )
    ) {
      return (
        workerOrigin +
        "/_img/" +
        url.hostname +
        url.pathname +
        url.search
      );
    }

    /*
     * Do not rewrite Googlevideo
     * URLs here. The Service Worker
     * intercepts them.
     */
    if (
      isGoogleVideoHost(
        url.hostname
      )
    ) {
      return value;
    }

    return value;
  } catch {
    return value;
  }
}

function rewriteImageURLsInText(
  text,
  workerOrigin
) {
  for (
    const host of PROXY_IMAGE_HOSTS
  ) {
    text = text.replaceAll(
      "https://" + host,
      workerOrigin +
      "/_img/" +
      host
    );

    text = text.replaceAll(
      "https:\\/\\/" + host,
      workerOrigin +
      "/_img/" +
      host
    );

    text = text.replaceAll(
      "//" + host,
      workerOrigin +
      "/_img/" +
      host
    );
  }

  return text;
}

/*
 * Preserve Set-Cookie headers returned
 * by YouTube while making them usable
 * on the Worker hostname.
 */
function copyYouTubeCookies(
  sourceHeaders,
  destinationHeaders
) {
  let cookies = [];

  try {
    if (
      typeof sourceHeaders.getSetCookie ===
      "function"
    ) {
      cookies =
        sourceHeaders.getSetCookie();
    } else if (
      typeof sourceHeaders.getAll ===
      "function"
    ) {
      cookies =
        sourceHeaders.getAll(
          "Set-Cookie"
        );
    } else {
      const cookie =
        sourceHeaders.get(
          "Set-Cookie"
        );

      if (cookie) {
        cookies = [cookie];
      }
    }
  } catch {}

  for (
    const cookie of cookies
  ) {
    if (!cookie) continue;

    const rewrittenCookie =
      cookie
        .replace(
          /;\s*Domain=[^;]*/gi,
          ""
        )
        .replace(
          /;\s*Path=[^;]*/gi,
          "; Path=/"
        );

    destinationHeaders.append(
      "Set-Cookie",
      rewrittenCookie
    );
  }
}

/*
 * YouTube video Service Worker.
 */
function createVideoServiceWorker() {
  return `

self.addEventListener(
  "install",
  function (event) {
    self.skipWaiting();
  }
);

self.addEventListener(
  "activate",
  function (event) {
    event.waitUntil(
      self.clients.claim()
    );
  }
);

self.addEventListener(
  "fetch",
  function (event) {
    const request =
      event.request;

    let url;

    try {
      url =
        new URL(
          request.url
        );
    } catch {
      return;
    }

    /*
     * Only intercept Googlevideo
     * requests.
     */
    if (
      url.hostname !==
        "googlevideo.com" &&
      !url.hostname.endsWith(
        ".googlevideo.com"
      )
    ) {
      return;
    }

    event.respondWith(
      (async function () {

        /*
         * The original signed
         * Googlevideo URL.
         */
        const videoURL =
          request.url;

        const relayHeaders =
          new Headers();

        /*
         * Range.
         */
        const range =
          request.headers.get(
            "Range"
          );

        if (range) {
          relayHeaders.set(
            "X-Video-Range",
            range
          );
        }

        /*
         * Accept.
         */
        const accept =
          request.headers.get(
            "Accept"
          );

        if (accept) {
          relayHeaders.set(
            "X-Video-Accept",
            accept
          );
        }

        /*
         * Accept-Language.
         */
        const acceptLanguage =
          request.headers.get(
            "Accept-Language"
          );

        if (acceptLanguage) {
          relayHeaders.set(
            "X-Video-Accept-Language",
            acceptLanguage
          );
        }

        /*
         * Send the complete signed
         * Googlevideo URL in the POST
         * body.
         *
         * We intentionally do not depend
         * on X-Video-URL.
         */
        relayHeaders.set(
          "Content-Type",
          "text/plain;charset=UTF-8"
        );

        const relayURL =
          self.location.origin +
          "/_video";

        try {

          const response =
            await fetch(
              relayURL,
              {
                method: "POST",

                headers:
                  relayHeaders,

                body:
                  videoURL,

                cache:
                  "no-store"
              }
            );

          return response;

        } catch (error) {

          return new Response(
            "Video relay request failed:\n" +
            String(error),
            {
              status: 502,

              headers: {
                "Content-Type":
                  "text/plain;charset=UTF-8"
              }
            }
          );

        }

      })()
    );
  }
);

`;
}

/*
 * Register the Service Worker.
 *
 * No forced reload.
 */
function createRequestInterceptor() {
  return `

<script>

(function () {

  if (
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  navigator.serviceWorker
    .register(
      "/yt-video-sw.js",
      {
        scope: "/"
      }
    )
    .then(function () {
      console.log(
        "YouTube video Service Worker registered"
      );
    })
    .catch(function (error) {
      console.error(
        "YouTube video Service Worker failed:",
        error
      );
    });

})();

</script>

`;
}

export default {
  async fetch(
    request,
    env
  ) {
    const incoming =
      new URL(
        request.url
      );

    /*
     * Service Worker file.
     */
    if (
      incoming.pathname ===
      "/yt-video-sw.js"
    ) {
      return new Response(
        createVideoServiceWorker(),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/javascript; charset=UTF-8",

            "Cache-Control":
              "no-store",

            "Service-Worker-Allowed":
              "/"
          }
        }
      );
    }

    /*
     * Image proxy.
     */
    if (
      incoming.pathname.startsWith(
        "/_img/"
      )
    ) {
      const parts =
        incoming.pathname.split(
          "/"
        );

      const host =
        parts[2];

      if (
        !isImageHost(host)
      ) {
        return new Response(
          "Forbidden",
          {
            status: 403
          }
        );
      }

      const imagePath =
        "/" +
        parts
          .slice(3)
          .join("/");

      const target =
        "https://" +
        host +
        imagePath +
        incoming.search;

      const imageHeaders =
        new Headers();

      const userAgent =
        request.headers.get(
          "User-Agent"
        );

      if (userAgent) {
        imageHeaders.set(
          "User-Agent",
          userAgent
        );
      }

      const referer =
        request.headers.get(
          "Referer"
        );

      if (referer) {
        imageHeaders.set(
          "Referer",
          YOUTUBE_ORIGIN + "/"
        );
      }

      const cookie =
        request.headers.get(
          "Cookie"
        );

      if (cookie) {
        imageHeaders.set(
          "Cookie",
          cookie
        );
      } else if (
        env.YOUTUBE_COOKIES
      ) {
        imageHeaders.set(
          "Cookie",
          env.YOUTUBE_COOKIES
        );
      }

      const imageResponse =
        await fetch(
          target,
          {
            headers:
              imageHeaders
          }
        );

      const imageResponseHeaders =
        new Headers(
          imageResponse.headers
        );

      copyYouTubeCookies(
        imageResponse.headers,
        imageResponseHeaders
      );

      return new Response(
        imageResponse.body,
        {
          status:
            imageResponse.status,

          statusText:
            imageResponse.statusText,

          headers:
            imageResponseHeaders
        }
      );
    }

    /*
     * Native YouTube video relay.
     *
     * Supports:
     *
     * GET /_video?url=...
     *
     * POST /_video
     *
     * POST /_video with X-Video-URL
     */
    if (
      incoming.pathname ===
      "/_video"
    ) {
      try {

        /*
         * For POST requests the body is
         * the primary source.
         */
        let videoURL = "";

        if (
          request.method ===
          "POST"
        ) {
          videoURL =
            await request.text();
        }

        /*
         * Header is only a fallback.
         */
        if (!videoURL) {
          videoURL =
            request.headers.get(
              "X-Video-URL"
            ) || "";
        }

        /*
         * GET query string is the
         * final fallback.
         */
        if (!videoURL) {
          videoURL =
            incoming.searchParams.get(
              "url"
            ) || "";
        }

        if (!videoURL) {
          return new Response(
            "Missing video URL",
            {
              status: 400,

              headers: {
                "Content-Type":
                  "text/plain; charset=UTF-8",

                "Cache-Control":
                  "no-store"
              }
            }
          );
        }

        let videoTarget;

        try {
          videoTarget =
            new URL(
              videoURL
            );
        } catch {
          return new Response(
            "Invalid video URL",
            {
              status: 400,

              headers: {
                "Content-Type":
                  "text/plain; charset=UTF-8",

                "Cache-Control":
                  "no-store"
              }
            }
          );
        }

        if (
          !isGoogleVideoHost(
            videoTarget.hostname
          )
        ) {
          return new Response(
            "Forbidden video host",
            {
              status: 403,

              headers: {
                "Content-Type":
                  "text/plain; charset=UTF-8",

                "Cache-Control":
                  "no-store"
              }
            }
          );
        }

        const videoHeaders =
          new Headers();

        /*
         * Range.
         */
        const range =
          request.headers.get(
            "X-Video-Range"
          );

        if (range) {
          videoHeaders.set(
            "Range",
            range
          );
        }

        /*
         * User-Agent.
         */
        const userAgent =
          request.headers.get(
            "User-Agent"
          );

        if (userAgent) {
          videoHeaders.set(
            "User-Agent",
            userAgent
          );
        }

        /*
         * Accept.
         */
        const accept =
          request.headers.get(
            "X-Video-Accept"
          );

        if (accept) {
          videoHeaders.set(
            "Accept",
            accept
          );
        }

        /*
         * Accept-Language.
         */
        const acceptLanguage =
          request.headers.get(
            "X-Video-Accept-Language"
          );

        if (acceptLanguage) {
          videoHeaders.set(
            "Accept-Language",
            acceptLanguage
          );
        }

        /*
         * Cookie.
         *
         * Priority:
         *
         * 1. X-Video-Cookie
         * 2. Worker YOUTUBE_COOKIES Secret
         * 3. Browser Cookie
         */
        const videoCookie =
          request.headers.get(
            "X-Video-Cookie"
          );

        if (videoCookie) {
          videoHeaders.set(
            "Cookie",
            videoCookie
          );
        } else if (
          env.YOUTUBE_COOKIES
        ) {
          videoHeaders.set(
            "Cookie",
            env.YOUTUBE_COOKIES
          );
        } else {
          const cookie =
            request.headers.get(
              "Cookie"
            );

          if (cookie) {
            videoHeaders.set(
              "Cookie",
              cookie
            );
          }
        }

        /*
         * YouTube playback referer.
         */
        videoHeaders.set(
          "Referer",
          YOUTUBE_ORIGIN + "/"
        );

        /*
         * Fetch the actual UMP stream.
         */
        const videoResponse =
          await fetch(
            videoTarget.toString(),
            {
              method: "GET",

              headers:
                videoHeaders,

              redirect:
                "follow"
            }
          );

        const responseHeaders =
          new Headers(
            videoResponse.headers
          );

        responseHeaders.set(
          "Access-Control-Allow-Origin",
          incoming.origin
        );

        responseHeaders.set(
          "Access-Control-Allow-Credentials",
          "true"
        );

        responseHeaders.set(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Range, Content-Type, Accept-Ranges"
        );

        return new Response(
          videoResponse.body,
          {
            status:
              videoResponse.status,

            statusText:
              videoResponse.statusText,

            headers:
              responseHeaders
          }
        );

      } catch (error) {
        return new Response(
          "VIDEO RELAY ERROR\n\n" +
          String(error) +
          "\n\n" +
          (
            error &&
            error.stack
              ? error.stack
              : ""
          ),
          {
            status: 500,

            headers: {
              "Content-Type":
                "text/plain; charset=UTF-8",

              "Cache-Control":
                "no-store"
            }
          }
        );
      }
    }

    /*
     * Old token endpoint is disabled.
     */
    if (
      incoming.pathname ===
      "/_video-token"
    ) {
      return new Response(
        "Gone",
        {
          status: 410
        }
      );
    }

    /*
     * Consent proxy.
     *
     * Browser URL:
     * /_consent/...
     *
     * Worker upstream:
     * consent.youtube.com/...
     */
    if (
      incoming.pathname ===
        "/_consent" ||
      incoming.pathname.startsWith(
        "/_consent/"
      )
    ) {
      const consentPath =
        incoming.pathname.replace(
          /^\/_consent/,
          ""
        ) || "/";

      const consentTarget =
        CONSENT_ORIGIN +
        consentPath +
        incoming.search;

      const consentHeaders =
        new Headers(
          request.headers
        );

      consentHeaders.delete(
        "Host"
      );

      consentHeaders.set(
        "Referer",
        YOUTUBE_ORIGIN + "/"
      );

      /*
       * Use the exported YouTube
       * cookies when configured.
       */
      if (
        env.YOUTUBE_COOKIES
      ) {
        consentHeaders.set(
          "Cookie",
          env.YOUTUBE_COOKIES
        );
      }

      const consentRequest =
        new Request(
          consentTarget,
          {
            method:
              request.method,

            headers:
              consentHeaders,

            body:
              request.method === "GET" ||
              request.method === "HEAD"
                ? undefined
                : request.body,

            redirect:
              "manual"
          }
        );

      const consentResponse =
        await fetch(
          consentRequest
        );

      const consentResponseHeaders =
        new Headers(
          consentResponse.headers
        );

      copyYouTubeCookies(
        consentResponse.headers,
        consentResponseHeaders
      );

      /*
       * Rewrite consent redirects so
       * the browser never navigates to
       * consent.youtube.com directly.
       */
      const consentLocation =
        consentResponseHeaders.get(
          "Location"
        );

      if (consentLocation) {
        try {
          const redirectURL =
            new URL(
              consentLocation,
              CONSENT_ORIGIN
            );

          if (
            isConsentHost(
              redirectURL.hostname
            )
          ) {
            consentResponseHeaders.set(
              "Location",
              incoming.origin +
              "/_consent" +
              redirectURL.pathname +
              redirectURL.search +
              redirectURL.hash
            );
          } else if (
            redirectURL.hostname ===
            "m.youtube.com"
          ) {
            consentResponseHeaders.set(
              "Location",
              incoming.origin +
              "/_mobile" +
              redirectURL.pathname +
              redirectURL.search +
              redirectURL.hash
            );
          } else if (
            isYouTubeHost(
              redirectURL.hostname
            )
          ) {
            consentResponseHeaders.set(
              "Location",
              incoming.origin +
              redirectURL.pathname +
              redirectURL.search +
              redirectURL.hash
            );
          }
        } catch {}
      }

      return new Response(
        consentResponse.body,
        {
          status:
            consentResponse.status,

          statusText:
            consentResponse.statusText,

          headers:
            consentResponseHeaders
        }
      );
    }

    /*
     * Detect requests routed through
     * the mobile YouTube prefix.
     */
    const isMobileRequest =
      incoming.pathname ===
        "/_mobile" ||
      incoming.pathname.startsWith(
        "/_mobile/"
      );

    const mobilePath =
      isMobileRequest
        ? incoming.pathname.replace(
            /^\/_mobile/,
            ""
          ) || "/"
        : incoming.pathname;

    /*
     * Map the request to the correct
     * upstream YouTube host.
     */
    const upstreamOrigin =
      isMobileRequest
        ? MOBILE_YOUTUBE_ORIGIN
        : YOUTUBE_ORIGIN;

    const target =
      new URL(
        upstreamOrigin +
        mobilePath +
        incoming.search
      );

    const headers =
      new Headers(
        request.headers
      );

    /*
     * Preserve browser cookies when
     * the browser actually sends them.
     *
     * Otherwise use the Cloudflare
     * YOUTUBE_COOKIES Secret.
     */
    const cookie =
      request.headers.get(
        "Cookie"
      );

    if (cookie) {
      headers.set(
        "Cookie",
        cookie
      );
    } else if (
      env.YOUTUBE_COOKIES
    ) {
      headers.set(
        "Cookie",
        env.YOUTUBE_COOKIES
      );
    }

    headers.delete(
      "Host"
    );

    if (
      headers.has("Origin")
    ) {
      headers.set(
        "Origin",
        upstreamOrigin
      );
    }

    if (
      headers.has("Referer")
    ) {
      headers.set(
        "Referer",
        upstreamOrigin + "/"
      );
    }

    headers.delete(
      "cf-connecting-ip"
    );

    headers.delete(
      "cf-ray"
    );

    headers.delete(
      "cf-visitor"
    );

    const upstream =
      new Request(
        target,
        {
          method:
            request.method,

          headers:
            headers,

          body:
            request.method === "GET" ||
            request.method === "HEAD"
              ? undefined
              : request.body,

          redirect:
            "manual"
        }
      );

    const response =
      await fetch(
        upstream
      );

    const responseHeaders =
      new Headers(
        response.headers
      );

    /*
     * Preserve cookies returned by YouTube.
     */
    copyYouTubeCookies(
      response.headers,
      responseHeaders
    );

    /*
     * Rewrite YouTube and consent
     * redirects so the browser stays
     * on the Worker hostname.
     */
    const location =
      responseHeaders.get(
        "Location"
      );

    if (location) {
      try {
        const redirectURL =
          new URL(
            location,
            upstreamOrigin
          );

        if (
          redirectURL.hostname ===
          "m.youtube.com"
        ) {
          responseHeaders.set(
            "Location",
            incoming.origin +
            "/_mobile" +
            redirectURL.pathname +
            redirectURL.search +
            redirectURL.hash
          );
        } else if (
          isYouTubeHost(
            redirectURL.hostname
          )
        ) {
          responseHeaders.set(
            "Location",
            incoming.origin +
            redirectURL.pathname +
            redirectURL.search +
            redirectURL.hash
          );
        } else if (
          isConsentHost(
            redirectURL.hostname
          )
        ) {
          responseHeaders.set(
            "Location",
            incoming.origin +
            "/_consent" +
            redirectURL.pathname +
            redirectURL.search +
            redirectURL.hash
          );
        }
      } catch {}
    }

    const contentType =
      responseHeaders.get(
        "content-type"
      ) || "";

    /*
     * Rewrite HTML.
     */
    if (
      contentType.includes(
        "text/html"
      )
    ) {
      responseHeaders.delete(
        "content-length"
      );

      responseHeaders.delete(
        "content-encoding"
      );

      responseHeaders.delete(
        "content-security-policy"
      );

      responseHeaders.delete(
        "content-security-policy-report-only"
      );

      /*
       * Resolve relative URLs against
       * the actual upstream host.
       */
      const htmlBaseOrigin =
        incoming.pathname ===
          "/_consent" ||
        incoming.pathname.startsWith(
          "/_consent/"
        )
          ? CONSENT_ORIGIN
          : isMobileRequest
            ? MOBILE_YOUTUBE_ORIGIN
            : YOUTUBE_ORIGIN;

      const rewriter =
        new HTMLRewriter()

          .on("head", {
            element(element) {
              element.append(
                createRequestInterceptor(),
                {
                  html: true
                }
              );
            }
          })

          .on("a", {
            element(element) {
              const href =
                element.getAttribute(
                  "href"
                );

              if (href) {
                element.setAttribute(
                  "href",
                  rewriteURL(
                    href,
                    incoming.origin,
                    htmlBaseOrigin
                  )
                );
              }
            }
          })

          .on("script", {
            element(element) {
              const src =
                element.getAttribute(
                  "src"
                );

              if (src) {
                element.setAttribute(
                  "src",
                  rewriteURL(
                    src,
                    incoming.origin,
                    htmlBaseOrigin
                  )
                );
              }
            }
          })

          .on("link", {
            element(element) {
              const href =
                element.getAttribute(
                  "href"
                );

              if (href) {
                element.setAttribute(
                  "href",
                  rewriteURL(
                    href,
                    incoming.origin,
                    htmlBaseOrigin
                  )
                );
              }
            }
          })

          .on("img", {
            element(element) {
              const src =
                element.getAttribute(
                  "src"
                );

              if (src) {
                element.setAttribute(
                  "src",
                  rewriteURL(
                    src,
                    incoming.origin,
                    htmlBaseOrigin
                  )
                );
              }
            }
          })

          .on("iframe", {
            element(element) {
              const src =
                element.getAttribute(
                  "src"
                );

              if (src) {
                element.setAttribute(
                  "src",
                  rewriteURL(
                    src,
                    incoming.origin,
                    htmlBaseOrigin
                  )
                );
              }
            }
          });

      return rewriter.transform(
        new Response(
          response.body,
          {
            status:
              response.status,

            statusText:
              response.statusText,

            headers:
              responseHeaders
          }
        )
      );
    }

    /*
     * Rewrite image URLs inside
     * YouTube JSON/API responses.
     */
    if (
      contentType.includes(
        "application/json"
      )
    ) {
      const text =
        await response.text();

      const rewritten =
        rewriteImageURLsInText(
          text,
          incoming.origin
        );

      responseHeaders.delete(
        "content-length"
      );

      responseHeaders.delete(
        "content-encoding"
      );

      return new Response(
        rewritten,
        {
          status:
            response.status,

          statusText:
            response.statusText,

          headers:
            responseHeaders
        }
      );
    }

    /*
     * Everything else passes through
     * unchanged.
     */
    return new Response(
      response.body,
      {
        status:
          response.status,

        statusText:
          response.statusText,

        headers:
          responseHeaders
      }
    );
  }
};
