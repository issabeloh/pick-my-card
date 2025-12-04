// Prerender.io integration for Cloudflare Pages
// This middleware intercepts requests from search engine crawlers
// and serves pre-rendered content from Prerender.io

// User agents handled by Prerender
const BOT_AGENTS = [
  "googlebot",
  "yahoo! slurp",
  "bingbot",
  "yandex",
  "baiduspider",
  "facebookexternalhit",
  "twitterbot",
  "rogerbot",
  "linkedinbot",
  "embedly",
  "quora link preview",
  "showyoubot",
  "outbrain",
  "pinterest/0.",
  "developers.google.com/+/web/snippet",
  "slackbot",
  "vkshare",
  "w3c_validator",
  "redditbot",
  "applebot",
  "whatsapp",
  "flipboard",
  "tumblr",
  "bitlybot",
  "skypeuripreview",
  "nuzzel",
  "discordbot",
  "google page speed",
  "qwantify",
  "pinterestbot",
  "bitrix link preview",
  "xing-contenttabreceiver",
  "chrome-lighthouse",
  "telegrambot",
  "integration-test",
  "google-inspectiontool"
];

// Extensions to skip prerendering
const IGNORE_EXTENSIONS = [
  ".js",
  ".css",
  ".xml",
  ".less",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".doc",
  ".txt",
  ".ico",
  ".rss",
  ".zip",
  ".mp3",
  ".rar",
  ".exe",
  ".wmv",
  ".doc",
  ".avi",
  ".ppt",
  ".mpg",
  ".mpeg",
  ".tif",
  ".wav",
  ".mov",
  ".psd",
  ".ai",
  ".xls",
  ".mp4",
  ".m4a",
  ".swf",
  ".dat",
  ".dmg",
  ".iso",
  ".flv",
  ".m4v",
  ".torrent",
  ".woff",
  ".ttf",
  ".svg",
  ".webmanifest",
];

export async function onRequest(context) {
  const { request, env, next } = context;

  try {
    const url = new URL(request.url);
    const userAgent = request.headers.get("User-Agent")?.toLowerCase() || "";
    const isPrerender = request.headers.get("X-Prerender");
    const pathName = url.pathname.toLowerCase();
    const extension = pathName.substring(pathName.lastIndexOf(".") || pathName.length)?.toLowerCase();

    // Skip if:
    // - Request already from Prerender (loop protection)
    // - Not a search engine bot
    // - Request is for a static file extension
    if (
      isPrerender ||
      !BOT_AGENTS.some((bot) => userAgent.includes(bot)) ||
      (extension.length && IGNORE_EXTENSIONS.includes(extension))
    ) {
      return next();
    }

    // Check if Prerender token is configured
    if (!env.PRERENDER_TOKEN) {
      console.error("PRERENDER_TOKEN environment variable not set");
      return next();
    }

    // Build Prerender.io request
    const prerenderUrl = `https://service.prerender.io/${request.url}`;
    const prerenderHeaders = new Headers(request.headers);
    prerenderHeaders.set("X-Prerender-Token", env.PRERENDER_TOKEN);

    // Fetch pre-rendered content from Prerender.io
    const response = await fetch(prerenderUrl, {
      headers: prerenderHeaders,
      redirect: "manual",
    });

    return response;
  } catch (error) {
    // If Prerender.io fails, fall back to serving the original page
    console.error("Prerender.io error:", error);
    return next();
  }
}
