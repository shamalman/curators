// ── YouTube Source Parser ──
// Handles youtube.com URLs — playlists, channels, single videos
//
// Reliability strategy (discovered via diagnostics 2026-03):
// - ytInitialData in script tags is the primary data source
// - Playlists: playlistVideoListRenderer.contents[] has title, channel, duration, videoId
// - Channels (@handle/videos): richGridRenderer.contents[] has videoRenderer with same fields
// - Videos: OG tags + JSON-LD VideoObject are reliable
// - oEmbed works for playlists and videos (title, author, thumbnail), 404 for channels
// - /c/ format is dead (404)

export const name = "youtube";
export const sourceType = "youtube";

export const patterns = [
  /^https?:\/\/(www\.)?youtube\.com\/(playlist|watch|channel|c\/|@|shorts\/)/i,
  /^https?:\/\/youtu\.be\//i,
  /^https?:\/\/(www\.)?youtube\.com\/live\//i,
];

export function classifyUrl(url) {
  if (/youtube\.com\/playlist/i.test(url)) return "profile";
  if (/youtube\.com\/@[^/]+/i.test(url)) return "profile";
  if (/youtube\.com\/channel\//i.test(url)) return "profile";
  if (/youtube\.com\/c\//i.test(url)) return "profile";
  if (/youtube\.com\/watch/i.test(url)) return "single_item";
  if (/youtube\.com\/shorts\//i.test(url)) return "single_item";
  if (/youtube\.com\/live\//i.test(url)) return "single_item";
  if (/youtu\.be\//i.test(url)) return "single_item";
  return "profile";
}

// ── URL helpers ──

function extractVideoId(url) {
  // youtube.com/watch?v=ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  // youtube.com/shorts/ID or /live/ID
  const pathMatch = url.match(/youtube\.com\/(?:shorts|live)\/([a-zA-Z0-9_-]{11})/);
  if (pathMatch) return pathMatch[1];
  return null;
}

function extractPlaylistId(url) {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function extractChannelHandle(url) {
  const match = url.match(/youtube\.com\/@([^/?]+)/i);
  return match ? match[1] : null;
}

function extractChannelId(url) {
  const match = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

// ── Fetch helpers ──

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": CHROME_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error("YouTube fetch error:", url, err);
    return null;
  }
}

async function fetchOEmbed(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("YouTube oEmbed fetch error:", err);
    return null;
  }
}

function extractYtInitialData(html) {
  const match = html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    console.error("YouTube: ytInitialData parse error:", err);
    return null;
  }
}

function extractMeta(html, property) {
  const match = html.match(new RegExp(`<meta[^>]*(?:property|name)="${property}"[^>]*content="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

// Parse duration text like "1:27:41" or "3:45" to seconds
function parseDurationText(text) {
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// ── Extraction strategies ──

// Playlist: extract videos from ytInitialData
function extractPlaylistVideos(data) {
  try {
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!tabs?.[0]) return null;

    const content = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!content?.[0]) return null;

    const items = content[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
    if (!items || items.length === 0) return null;

    const videos = [];
    for (const item of items) {
      const v = item.playlistVideoRenderer;
      if (!v) continue;

      const title = v.title?.runs?.[0]?.text;
      if (!title) continue;

      videos.push({
        title,
        artist: v.shortBylineText?.runs?.[0]?.text || null,
        url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null,
        itemType: "video",
        duration: v.lengthSeconds ? parseInt(v.lengthSeconds) : parseDurationText(v.lengthText?.simpleText),
      });
    }

    return videos.length > 0 ? videos : null;
  } catch (err) {
    console.error("YouTube: playlist extraction error:", err);
    return null;
  }
}

// Channel: extract videos from ytInitialData richGrid
function extractChannelVideos(data) {
  try {
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!tabs) return null;

    // Find the selected tab (usually "Videos")
    let gridContents = null;
    for (const tab of tabs) {
      const renderer = tab.tabRenderer;
      if (renderer?.selected && renderer?.content?.richGridRenderer?.contents) {
        gridContents = renderer.content.richGridRenderer.contents;
        break;
      }
    }

    if (!gridContents) return null;

    const videos = [];
    for (const item of gridContents) {
      const v = item?.richItemRenderer?.content?.videoRenderer;
      if (!v) continue;

      const title = v.title?.runs?.[0]?.text;
      if (!title) continue;

      videos.push({
        title,
        artist: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || null,
        url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null,
        itemType: "video",
        duration: parseDurationText(v.lengthText?.simpleText),
      });
    }

    return videos.length > 0 ? videos : null;
  } catch (err) {
    console.error("YouTube: channel extraction error:", err);
    return null;
  }
}

// Single video: extract from ytInitialData or OG tags
function extractVideoInfo(data, html) {
  // Try ytInitialData first
  if (data) {
    try {
      const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
      if (contents) {
        const primary = contents.find(c => c.videoPrimaryInfoRenderer);
        const secondary = contents.find(c => c.videoSecondaryInfoRenderer);

        const title = primary?.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text;
        const channel = secondary?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.text;

        if (title) {
          return {
            title,
            artist: channel || null,
          };
        }
      }
    } catch (err) {
      console.error("YouTube: video ytInitialData extraction error:", err);
    }
  }

  // Fallback to OG tags
  if (html) {
    const title = extractMeta(html, "og:title");
    if (title) {
      return { title, artist: null };
    }
  }

  return null;
}

// ── Main parse function ──

export async function parse(url) {
  const videoId = extractVideoId(url);
  const playlistId = extractPlaylistId(url);
  const channelHandle = extractChannelHandle(url);
  const channelId = extractChannelId(url);

  let items = [];
  const metadata = {
    source: "youtube",
    sourceType: "youtube",
    resourceType: "unknown",
    url,
    title: null,
    description: null,
    thumbnailUrl: null,
    providerName: "YouTube",
  };

  // ── Playlist ──
  // Routing rule: if the URL is a /watch or /shorts page, treat as video even when &list= is present.
  // Only treat as playlist when the URL is the dedicated /playlist endpoint (no v= param).
  const isPlaylistUrl = /youtube\.com\/playlist/i.test(url);
  if (playlistId && isPlaylistUrl) {
    metadata.resourceType = "playlist";
    const cleanUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    metadata.url = cleanUrl;

    const [oembed, html] = await Promise.all([
      fetchOEmbed(cleanUrl),
      fetchHtml(cleanUrl),
    ]);

    metadata.title = oembed?.title || null;
    metadata.thumbnailUrl = oembed?.thumbnail_url || null;

    if (html) {
      if (!metadata.title) metadata.title = extractMeta(html, "og:title");
      metadata.description = extractMeta(html, "og:description");
      if (!metadata.thumbnailUrl) metadata.thumbnailUrl = extractMeta(html, "og:image");

      const data = extractYtInitialData(html);
      if (data) {
        items = extractPlaylistVideos(data) || [];
      }
    }

    // Fallback metadata from oEmbed
    if (oembed?.author_name && items.length === 0) {
      metadata.description = metadata.description || `Playlist by ${oembed.author_name}`;
    }

  // ── Channel ──
  } else if (channelHandle || channelId) {
    metadata.resourceType = "channel";
    const channelPath = channelHandle ? `@${channelHandle}` : `channel/${channelId}`;
    const channelUrl = `https://www.youtube.com/${channelPath}/videos`;
    metadata.url = channelUrl;

    const html = await fetchHtml(channelUrl);

    if (html) {
      metadata.title = extractMeta(html, "og:title");
      metadata.description = extractMeta(html, "og:description");
      metadata.thumbnailUrl = extractMeta(html, "og:image");

      const data = extractYtInitialData(html);
      if (data) {
        // Channel metadata
        const channelMeta = data?.metadata?.channelMetadataRenderer;
        if (channelMeta) {
          metadata.title = metadata.title || channelMeta.title;
          metadata.description = metadata.description || channelMeta.description;
        }

        items = extractChannelVideos(data) || [];
      }
    }

  // ── Single video ──
  } else if (videoId) {
    metadata.resourceType = "video";
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    metadata.url = cleanUrl;

    const [oembed, html] = await Promise.all([
      fetchOEmbed(cleanUrl),
      fetchHtml(cleanUrl),
    ]);

    metadata.title = oembed?.title || null;
    metadata.thumbnailUrl = oembed?.thumbnail_url || null;

    if (html) {
      if (!metadata.title) metadata.title = extractMeta(html, "og:title");
      metadata.description = extractMeta(html, "og:description");
      if (!metadata.thumbnailUrl) metadata.thumbnailUrl = extractMeta(html, "og:image");

      const data = extractYtInitialData(html);
      const videoInfo = extractVideoInfo(data, html);

      if (videoInfo) {
        items = [{
          title: videoInfo.title,
          artist: videoInfo.artist || oembed?.author_name || null,
          url: cleanUrl,
          itemType: "video",
          duration: null,
        }];
      }
    }

    // Fallback to oEmbed
    if (items.length === 0 && oembed?.title) {
      items = [{
        title: oembed.title,
        artist: oembed.author_name || null,
        url: cleanUrl,
        itemType: "video",
        duration: null,
      }];
    }
  }

  // Normalize items with position
  items = items.map((t, i) => ({
    position: i + 1,
    title: t.title,
    artist: t.artist || null,
    showName: t.showName || null,
    url: t.url || null,
    itemType: t.itemType || "video",
    duration: t.duration || null,
    description: t.description || null,
  }));

  return { metadata, items };
}
