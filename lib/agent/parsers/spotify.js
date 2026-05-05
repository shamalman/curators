// ── Spotify Source Parser ──
// Handles open.spotify.com URLs — playlists, profiles, tracks, albums
//
// Reliability strategy (discovered via diagnostics 2026-03):
// - Main page with Chrome UA returns a tiny JS shell (~6KB) — no data
// - Main page with no UA returns ld+json but @type:MusicGroup, no tracks
// - Embed page (/embed/) is the reliable source: has __NEXT_DATA__ with
//   full trackList (title, subtitle/artist, duration, entityType, uri)
// - oEmbed always works for metadata (title, thumbnail, description)
//
// Order: oEmbed (metadata) + embed page (tracks) → main page fallbacks → oEmbed-only graceful degradation

export const name = "spotify";
export const sourceType = "spotify";

export const patterns = [
  /^https?:\/\/(open\.)?spotify\.com\/(playlist|user|track|album|artist)\//i,
];

export function classifyUrl(url) {
  if (/spotify\.com\/playlist\//i.test(url)) return "profile";
  if (/spotify\.com\/user\//i.test(url)) return "profile";
  if (/spotify\.com\/artist\//i.test(url)) return "profile";
  if (/spotify\.com\/track\//i.test(url)) return "single_item";
  if (/spotify\.com\/album\//i.test(url)) return "single_item";
  return "profile";
}

// Extract Spotify resource ID from URL
function extractId(url) {
  const match = url.match(/spotify\.com\/(playlist|user|track|album|artist)\/([a-zA-Z0-9]+)/);
  return match ? { type: match[1], id: match[2] } : null;
}

// ── Fetch helpers ──

async function fetchOEmbed(url) {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Spotify oEmbed fetch error:", err);
    return null;
  }
}

async function fetchHtml(url, userAgent) {
  try {
    const headers = { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" };
    if (userAgent) headers["User-Agent"] = userAgent;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error("Spotify fetch error:", url, err);
    return null;
  }
}

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Track extraction strategies ──

// Strategy A (primary): Embed page __NEXT_DATA__
// The embed page reliably serves __NEXT_DATA__ with entity.trackList
function extractFromEmbedNextData(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (!entity) return null;

    const trackList = entity.trackList || [];
    if (trackList.length === 0) return null;

    const items = trackList.map((t) => {
      const isEpisode = t.entityType === "episode" || t.type === "episode";
      return {
        title: t.title || t.name || null,
        artist: isEpisode ? null : (t.subtitle || null),
        showName: isEpisode ? (t.subtitle || null) : null,
        url: t.uri || null,
        itemType: isEpisode ? "episode" : "track",
        duration: t.duration ? Math.round(t.duration / 1000) : null,
      };
    }).filter(t => t.title);

    // Also extract metadata from entity
    const meta = {
      title: entity.title || entity.name || null,
      subtitle: entity.subtitle || null,
      description: entity.description || null,
    };

    return { items, meta };
  } catch (err) {
    console.error("Spotify: embed __NEXT_DATA__ parse error:", err);
    return null;
  }
}

// Strategy B (fallback): Main page JSON-LD
// Sometimes serves ld+json with track data (MusicPlaylist, MusicAlbum, etc.)
function extractFromJsonLd(html) {
  const items = [];
  const scriptMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scriptMatches) {
    try {
      const data = JSON.parse(match[1]);

      if (data["@type"] === "MusicPlaylist" && data.track) {
        const trackList = Array.isArray(data.track) ? data.track : [data.track];
        for (const t of trackList) {
          if (t.name) {
            items.push({
              title: t.name,
              artist: t.byArtist?.name || t.creator?.name || null,
              url: t.url || null,
              itemType: "track",
              duration: t.duration || null,
            });
          }
        }
      }

      if (data["@type"] === "MusicAlbum" && data.track) {
        const trackList = Array.isArray(data.track) ? data.track : [data.track];
        for (const t of trackList) {
          if (t.name) {
            items.push({
              title: t.name,
              artist: data.byArtist?.name || null,
              url: t.url || null,
              itemType: "track",
              duration: t.duration || null,
            });
          }
        }
      }

      if (data["@type"] === "PodcastEpisode") {
        items.push({
          title: data.name, artist: null,
          showName: data.partOfSeries?.name || null,
          url: data.url || null, itemType: "episode",
          duration: data.timeRequired || data.duration || null,
          description: data.description || null,
        });
      }

      if (data["@type"] === "PodcastSeries" && data.episode) {
        const episodes = Array.isArray(data.episode) ? data.episode : [data.episode];
        for (const ep of episodes) {
          if (ep.name) {
            items.push({
              title: ep.name, artist: null,
              showName: data.name || null,
              url: ep.url || null, itemType: "episode",
              duration: ep.timeRequired || ep.duration || null,
              description: ep.description || null,
            });
          }
        }
      }
    } catch (err) {
      // JSON parse failed, skip
    }
  }
  return items.length > 0 ? items : null;
}

// Strategy C (fallback): Main page __NEXT_DATA__ (older Spotify layout)
function extractFromMainNextData(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (!entity) return null;

    const trackItems = entity.trackList || entity.tracks?.items || [];
    if (trackItems.length === 0) return null;

    return trackItems.map((t) => {
      const inner = t.track || t;
      if (!inner.name && !inner.title) return null;
      const isEpisode = inner.type === "episode" || inner.entityType === "episode" || inner.is_podcast || !!inner.show;
      return {
        title: inner.name || inner.title || null,
        artist: isEpisode ? null : (inner.artists?.[0]?.name || inner.subtitle || null),
        showName: isEpisode ? (inner.show?.name || inner.subtitle || null) : null,
        url: inner.uri || null,
        itemType: isEpisode ? "episode" : "track",
        duration: inner.duration_ms ? Math.round(inner.duration_ms / 1000) : (inner.duration ? Math.round(inner.duration / 1000) : null),
        description: inner.description || null,
      };
    }).filter(Boolean);
  } catch (err) {
    return null;
  }
}

// Strategy D (last resort): meta tags / tracklist-row DOM
function extractFromMetaAndDom(html) {
  const items = [];

  const metaMusic = html.matchAll(/<meta[^>]*property="music:song"[^>]*content="([^"]+)"[^>]*>/gi);
  for (const m of metaMusic) {
    items.push({ title: null, artist: null, url: m[1], itemType: "track" });
  }

  if (items.length === 0) {
    const titleMatches = html.matchAll(/data-testid="tracklist-row"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi);
    for (const m of titleMatches) {
      items.push({ title: m[1].trim(), artist: m[2].trim(), url: null, itemType: "track" });
    }
  }

  return items.length > 0 ? items : null;
}

function extractMeta(html, property) {
  const match = html.match(new RegExp(`<meta[^>]*(?:property|name)="${property}"[^>]*content="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

// ── Main parse function ──

export async function parse(url) {
  const resource = extractId(url);
  if (!resource) {
    throw new Error(`Could not parse Spotify URL: ${url}`);
  }

  const cleanUrl = `https://open.spotify.com/${resource.type}/${resource.id}`;
  const embedUrl = `https://open.spotify.com/embed/${resource.type}/${resource.id}`;

  // Fetch oEmbed + embed page in parallel (primary sources)
  const [oembed, embedHtml] = await Promise.all([
    fetchOEmbed(cleanUrl),
    fetchHtml(embedUrl, CHROME_UA),
  ]);

  const metadata = {
    source: "spotify",
    sourceType: "spotify",
    resourceType: resource.type,
    url: cleanUrl,
    title: oembed?.title || null,
    description: null,
    thumbnailUrl: oembed?.thumbnail_url || null,
    providerName: oembed?.provider_name || "Spotify",
  };

  let items = [];

  // ── Playlists and Albums: multi-strategy track extraction ──
  if (resource.type === "playlist" || resource.type === "album") {

    // Strategy A: embed page __NEXT_DATA__ (most reliable)
    if (embedHtml) {
      const embedResult = extractFromEmbedNextData(embedHtml);
      if (embedResult && embedResult.items.length > 0) {
        items = embedResult.items;
        // Use embed metadata as fallback
        if (!metadata.title && embedResult.meta.title) metadata.title = embedResult.meta.title;
        if (embedResult.meta.description) metadata.description = embedResult.meta.description;
      }
    }

    // Strategy B/C/D: fall back to main page if embed gave nothing
    if (items.length === 0) {
      // Fetch main page (no UA gets more content than Chrome UA)
      const mainHtml = await fetchHtml(cleanUrl, null);
      if (mainHtml) {
        // Extract description from meta tags
        metadata.description = metadata.description || extractMeta(mainHtml, "og:description") || extractMeta(mainHtml, "description");
        if (!metadata.title) metadata.title = extractMeta(mainHtml, "og:title");

        // Try strategies in order
        items = extractFromJsonLd(mainHtml)
          || extractFromMainNextData(mainHtml)
          || extractFromMetaAndDom(mainHtml)
          || [];
      }
    }

    // For albums, ensure artist is populated
    if (resource.type === "album" && items.length > 0) {
      const albumArtist = oembed?.title?.split(" - ")?.[1]?.trim();
      if (albumArtist) {
        items = items.map(t => ({ ...t, artist: t.artist || albumArtist }));
      }
    }

  // ── Single track ──
  } else if (resource.type === "track") {
    // Strategy A: embed page __NEXT_DATA__
    if (embedHtml) {
      const embedResult = extractFromEmbedNextData(embedHtml);
      if (embedResult && embedResult.items.length > 0) {
        items = embedResult.items.slice(0, 1);
        console.log("[SPOTIFY] track: strategy A (embed next_data) produced item", { hasArtist: !!items[0]?.artist });
      }
    }
    // Strategy B: oEmbed title split
    if (items.length === 0 && oembed?.title) {
      const parts = oembed.title.split(" - ");
      items = [{
        position: 1,
        title: parts[0]?.trim() || oembed.title,
        artist: parts[1]?.trim() || null,
        url: cleanUrl,
        itemType: "track",
      }];
      console.log("[SPOTIFY] track: strategy B (oembed title split) produced item", { hasArtist: !!items[0]?.artist });
    }
    // Strategy C: main page og:description (runs if prior strategies left artist null)
    if (items.length > 0 && !items[0].artist) {
      const stratCStart = Date.now();
      console.log("[SPOTIFY] track: strategy C entry", { cleanUrl });
      const mainHtml = await fetchHtml(cleanUrl, null);
      if (mainHtml) {
        const ogDesc = extractMeta(mainHtml, "og:description");
        if (ogDesc) {
          // Spotify og:description shape: "Artist Name · Song · YYYY"
          const artistFromOg = ogDesc.split("·")[0]?.trim();
          if (artistFromOg) {
            items[0].artist = artistFromOg;
            console.log("[SPOTIFY] track: strategy C (og:description) filled artist", { artist: artistFromOg, elapsedMs: Date.now() - stratCStart });
          } else {
            console.warn("[SPOTIFY] track: strategy C og:description present but no artist token", { ogDesc, elapsedMs: Date.now() - stratCStart });
          }
        } else {
          console.warn("[SPOTIFY] track: strategy C main page fetched but no og:description", { elapsedMs: Date.now() - stratCStart });
        }
      } else {
        console.warn("[SPOTIFY] track: strategy C main page fetch returned null", { elapsedMs: Date.now() - stratCStart });
      }
    }
    if (items.length === 0) {
      console.warn("[SPOTIFY] track: all strategies failed, no items produced", { cleanUrl });
    } else if (!items[0].artist) {
      console.warn("[SPOTIFY] track: item produced but artist still null after all strategies", { title: items[0].title, cleanUrl });
    }

  // ── User profiles / Artists ──
  } else if (resource.type === "user" || resource.type === "artist") {
    // These need the main page for playlist links
    const mainHtml = await fetchHtml(cleanUrl, null);
    if (mainHtml) {
      metadata.title = metadata.title || extractMeta(mainHtml, "og:title");
      metadata.description = extractMeta(mainHtml, "og:description") || extractMeta(mainHtml, "description");
      const playlistLinks = mainHtml.matchAll(/href="\/playlist\/([a-zA-Z0-9]+)"/gi);
      for (const m of playlistLinks) {
        items.push({
          itemType: "playlist",
          url: `https://open.spotify.com/playlist/${m[1]}`,
          title: null,
        });
      }
    }
  }

  // Normalize items with position
  items = items.map((t, i) => ({
    position: i + 1,
    title: t.title,
    artist: t.artist || null,
    showName: t.showName || null,
    url: t.url || null,
    itemType: t.itemType || "track",
    duration: t.duration || null,
    description: t.description || null,
  }));

  // If we still have no description, try fetching main page just for meta
  if (!metadata.description && items.length > 0) {
    try {
      const mainHtml = await fetchHtml(cleanUrl, null);
      if (mainHtml) {
        metadata.description = extractMeta(mainHtml, "og:description") || extractMeta(mainHtml, "description");
      }
    } catch (err) {
      // Not critical — we have items, description is nice-to-have
    }
  }

  return { metadata, items };
}
