'use client'

import { useState, useEffect, useContext } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { T, F, S, CAT, FEATURES } from "@/lib/constants";
import { useCurator, CuratorContext } from "@/context/CuratorContext";
import RecCard from "@/components/recs/RecCard";

const CAT_COLORS = {
  watch: "#8E80B5", listen: "#4B92CC", read: "#CC6658", visit: "#5E9E82",
  get: "#C27850", wear: "#CC7090", play: "#D4B340", other: "#B08860",
};

const SOCIAL_URLS = {
  instagram: (h) => `https://instagram.com/${h}`,
  spotify: (h) => `https://open.spotify.com/user/${h}`,
  substack: (h) => `https://substack.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  threads: (h) => `https://threads.net/@${h}`,
  bluesky: (h) => `https://bsky.app/profile/${h}`,
  website: (h) => h,
};

const SOCIAL_ICONS = {
  instagram: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" fill="currentColor"/></svg>,
  spotify: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" fill="currentColor"/></svg>,
  substack: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" fill="currentColor"/></svg>,
  x: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" fill="currentColor"/></svg>,
  threads: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.343 3.616 8.878 3.589 12c.027 3.12.718 5.654 2.057 7.224 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.583-1.313-.877-2.39-.882h-.014c-.96 0-1.69.198-2.203.59-.48.37-.782.886-.918 1.553l-2.063-.421c.206-1.048.719-1.935 1.524-2.612.877-.733 2.01-1.116 3.67-1.116h.014c1.744.007 3.142.545 4.145 1.6 1.168 1.232 1.636 3.02 1.377 5.31.568.33 1.089.728 1.553 1.198 1.006 1.024 1.705 2.394 1.705 4.21 0 2.49-1.044 4.542-3.017 5.94-1.601 1.12-3.672 1.687-6.165 1.687H12.186zM13.56 14.326c.604-.05 1.136-.323 1.546-.796.545-.632.815-1.558.806-2.752a11.55 11.55 0 0 0-2.333-.122c-.931.056-1.682.327-2.193.784-.42.372-.636.843-.604 1.33.054.98.714 1.567 1.84 1.63.32.018.64.01.938-.074z" fill="currentColor"/></svg>,
  bluesky: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" fill="currentColor"/></svg>,
  website: <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/></svg>,
};

const responsiveCss = `
.desk-sub-wide { display: inline-flex; }
.desk-sub-narrow { display: none; }
@media (max-width: 860px) {
  .desk-sub-wide { display: none !important; }
  .desk-sub-narrow { display: inline-flex !important; }
}
@media (min-width: 720px) {
  .hero-cols { display: flex !important; gap: 28px; align-items: flex-start; }
  .hero-left { flex: 1; min-width: 260px; max-width: 440px; }
  .hero-right { width: 220px; flex-shrink: 0; }
}
`;

export default function VisitorProfile({ mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ctx = useCurator();
  const curatorCtx = useContext(CuratorContext);
  const { profile, profileId, tasteItems, isOwner } = ctx;
  const savedRecIds = curatorCtx?.savedRecIds;
  const saveRec = curatorCtx?.saveRec;
  const unsaveRec = curatorCtx?.unsaveRec;
  const [subToggling, setSubToggling] = useState(false);
  const [localSubbed, setLocalSubbed] = useState(false);
  const [myProfileId, setMyProfileId] = useState(null);
  const [subscribedToCount, setSubscribedToCount] = useState(0);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [filterCat, setFilterCat] = useState(null);
  const [socialHover, setSocialHover] = useState(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [profileView, setProfileView] = useState("recs");
  const [subsList, setSubsList] = useState(null);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subscribersList, setSubscribersList] = useState(null);
  const [subscribersLoading, setSubscribersLoading] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 720);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Check subscription status & counts
  useEffect(() => {
    if (!profileId || !profile) return;
    async function loadSubData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: myProf } = await supabase
            .from("profiles").select("id").eq("auth_user_id", user.id).single();
          if (myProf) {
            setMyProfileId(myProf.id);
            if (mode === "visitor" && !isOwner) {
              const { data } = await supabase
                .from("subscriptions").select("id")
                .eq("subscriber_id", myProf.id).eq("curator_id", profileId)
                .is("unsubscribed_at", null).limit(1);
              if (data && data.length > 0) setLocalSubbed(true);
            }
          }
        }

        // Subscriber count
        const { count: subCount } = await supabase
          .from("subscriptions").select("id", { count: "exact", head: true })
          .eq("curator_id", profileId).is("unsubscribed_at", null);
        setSubscriberCount(subCount || 0);

        // Subscribed-to count
        const { count: subToCount } = await supabase
          .from("subscriptions").select("id", { count: "exact", head: true })
          .eq("subscriber_id", profileId).is("unsubscribed_at", null);
        setSubscribedToCount(subToCount || 0);
      } catch (err) {
        console.warn("Failed to load sub data:", err);
      }
    }
    loadSubData();
  }, [profileId, profile, mode, isOwner]);

  if (!profile) return null;

  const handle = profile.handle.replace("@", "");
  const items = tasteItems;
  const n = items.length;
  const publicItems = items.filter(i => mode === "curator" || i.visibility === "public");
  const filteredItems = filterCat ? publicItems.filter(i => i.category === filterCat) : publicItems;
  const cats = [...new Set(publicItems.map(i => i.category))];
  const cc = {}; cats.forEach(c => { cc[c] = publicItems.filter(i => i.category === c).length; });
  const topCats = [...cats].sort((a, b) => (cc[b] || 0) - (cc[a] || 0));
  const firstName = profile.name.split(" ")[0];
  const socialLinks = profile.socialLinks || {};
  const hasSocials = Object.values(socialLinks).some(v => v && v.trim());

  const onSelectItem = (item) => {
    if (mode === "curator") {
      router.push(`/find/${item.slug}`);
    } else {
      router.push(`/${handle}/${item.slug}`);
    }
  };

  const handleSubscribe = async () => {
    if (!myProfileId) { window.location.href = '/login'; return; }
    if (subToggling || localSubbed) return;
    setSubToggling(true);
    try {
      const { data: existing } = await supabase.from("subscriptions")
        .select("*").eq("subscriber_id", myProfileId).eq("curator_id", profileId)
        .limit(1).maybeSingle();
      if (existing) {
        await supabase.from("subscriptions").update({ unsubscribed_at: null }).eq("id", existing.id);
      } else {
        await supabase.from("subscriptions").insert({ subscriber_id: myProfileId, curator_id: profileId });
      }
      setLocalSubbed(true);
      setSubscriberCount(c => c + 1);
      // Fire and forget — notify curator of new subscriber
      fetch('/api/notify/new-subscriber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curatorId: profileId, subscriberId: myProfileId }),
      }).catch(() => {});
    } catch (err) { console.error("Subscribe failed:", err); }
    finally { setSubToggling(false); }
  };

  const handleUnsubscribe = async () => {
    if (!myProfileId || subToggling || !localSubbed) return;
    setSubToggling(true);
    try {
      await supabase.from("subscriptions")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("subscriber_id", myProfileId)
        .eq("curator_id", profileId)
        .is("unsubscribed_at", null);
      setLocalSubbed(false);
      setSubscriberCount(c => Math.max(0, c - 1));
    } catch (err) { console.error("Unsubscribe failed:", err); }
    finally { setSubToggling(false); }
  };

  const loadSubscriptions = async () => {
    if (subsList || subsLoading) return;
    setSubsLoading(true);
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, curator_id")
        .eq("subscriber_id", profileId)
        .is("unsubscribed_at", null);
      if (error) throw error;
      const ids = (data || []).map(r => r.curator_id);
      if (ids.length === 0) { setSubsList([]); return; }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, handle")
        .in("id", ids);
      setSubsList(profiles || []);
    } catch (err) { console.error(err); setSubsList([]); }
    finally { setSubsLoading(false); }
  };

  const loadSubscribers = async () => {
    if (subscribersList || subscribersLoading) return;
    setSubscribersLoading(true);
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, subscriber_id")
        .eq("curator_id", profileId)
        .is("unsubscribed_at", null);
      if (error) throw error;
      const ids = (data || []).map(r => r.subscriber_id);
      if (ids.length === 0) { setSubscribersList([]); return; }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, handle")
        .in("id", ids);
      setSubscribersList(profiles || []);
    } catch (err) { console.error(err); setSubscribersList([]); }
    finally { setSubscribersLoading(false); }
  };

  const handleStatClick = (view) => {
    setProfileView(view);
    if (view === "subscriptions") loadSubscriptions();
    if (view === "subscribers") loadSubscribers();
  };

  const SubscribeBtn = ({ className }) => {
    const isNarrow = className === "desk-sub-narrow";
    const hideStyle = isNarrow ? { display: "none" } : {};
    if (isOwner) {
      return (
        <button className={className} onClick={() => router.push(`/${handle}/edit`)} style={{
          ...hideStyle,
          background: "transparent", border: `1.5px solid ${T.bdr}`, borderRadius: 20,
          padding: "7px 16px", cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink2,
        }}>Edit profile</button>
      );
    }
    if (mode !== "visitor") return null;
    if (localSubbed) {
      return (
        <button className={className} onClick={handleUnsubscribe} style={{
          ...hideStyle,
          background: "transparent", border: `1.5px solid ${T.ink3}`, borderRadius: 20,
          padding: "7px 16px", cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 700, color: T.ink2,
          alignItems: "center",
        }}>Subscribed ✓</button>
      );
    }
    return (
      <button className={className} onClick={handleSubscribe} style={{
        ...hideStyle,
        background: T.acc, border: "none", borderRadius: 20,
        padding: "7px 16px", cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 700, color: T.accText,
      }}>Subscribe</button>
    );
  };

  const AIPanelCompact = () => {
    if (!profile.aiEnabled || n < 5) return null;
    return (
      <div onClick={() => router.push(`/${handle}/ask`)} style={{
        display: "flex", alignItems: "center", gap: 12,
        background: T.s2, border: "1px solid rgba(212,149,107,0.2)", borderRadius: 12,
        padding: "12px 16px", cursor: "pointer",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: "rgba(212,149,107,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ fontFamily: S, fontSize: 13, color: T.acc, fontWeight: 700, fontStyle: "italic" }}>C</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink }}>Ask {firstName}'s AI</div>
          <div style={{ fontFamily: F, fontSize: 11, color: T.ink2, marginTop: 1 }}>Knows their perspective across {publicItems.length} recommendations</div>
        </div>
        <span style={{ fontSize: 16, color: T.acc, flexShrink: 0 }}>{"\u2192"}</span>
      </div>
    );
  };

  const AIPanelFull = () => {
    if (!profile.aiEnabled || n < 5) return null;
    return (
      <div>
        <div onClick={() => router.push(`/${handle}/ask`)} style={{
          background: T.s2, border: `1px solid rgba(212,149,107,0.2)`, borderRadius: 16,
          padding: 18, cursor: "pointer", transition: "border-color .15s",
        }} onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(212,149,107,0.4)"}
           onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(212,149,107,0.2)"}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: "rgba(212,149,107,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12,
          }}>
            <span style={{ fontFamily: S, fontSize: 16, color: T.acc, fontWeight: 700, fontStyle: "italic" }}>C</span>
          </div>
          <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink, marginBottom: 4 }}>
            Ask {firstName}'s AI
          </div>
          <div style={{ fontFamily: F, fontSize: 11, color: T.ink2, lineHeight: 1.5, marginBottom: 16 }}>
            Knows their perspective across {publicItems.length} recommendations
          </div>
          <div style={{
            width: "100%", padding: "10px 14px", background: T.acc, borderRadius: 10,
            fontFamily: F, fontSize: 12, fontWeight: 700, color: T.accText, textAlign: "center",
            border: "none", cursor: "pointer",
          }}>Start chatting →</div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", minHeight: 0 }}>
      <style>{responsiveCss}</style>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%" }}>

      {/* Back arrow for visitor mode */}
      {mode === "visitor" && !isOwner && (
        <div style={{ padding: "48px 20px 0" }}>
          <button onClick={() => router.back()} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Hero */}
      <div style={{ background: T.bg2, padding: isOwner ? "16px 20px 20px" : "36px 20px 20px" }}>
        <div className="hero-cols">
          <div className="hero-left">
            {/* Identity row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: T.s2, flexShrink: 0, marginTop: 3,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontFamily: S, fontSize: 18, color: T.acc, fontWeight: 400, fontStyle: "italic" }}>{profile.name[0]}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
                  <span style={{ fontFamily: S, fontSize: 24, color: T.ink, lineHeight: 1.1 }}>{profile.name}</span>
                  <SubscribeBtn className="desk-sub-wide" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: T.ink3, fontFamily: F }}>{profile.handle}</span>
                  <SubscribeBtn className="desk-sub-narrow" />
                </div>
              </div>
            </div>

            {/* Below identity */}
            <div>
              {/* Bio */}
              {profile.bio && profile.bio.trim() && (
                <p style={{ fontFamily: F, fontSize: 13, color: T.ink2, lineHeight: 1.6, marginTop: 10, marginBottom: 12 }}>
                  {profile.bio}
                </p>
              )}

              {/* Social links */}
              {FEATURES.socialLinks && hasSocials && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
                  {Object.entries(socialLinks).map(([key, val]) => {
                    if (!val || !val.trim()) return null;
                    const url = SOCIAL_URLS[key]?.(val);
                    if (!url) return null;
                    const isHovered = socialHover === key;
                    return (
                      <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                        onMouseEnter={() => setSocialHover(key)}
                        onMouseLeave={() => setSocialHover(null)}
                        style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: isHovered ? T.s3 : T.s2,
                          border: `1px solid ${isHovered ? T.ink3 : T.bdr}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: T.ink3, transition: "all .15s", textDecoration: "none",
                        }}>
                        {SOCIAL_ICONS[key]}
                      </a>
                    );
                  })}
                </div>
              )}

              {/* Stats row */}
              {(profile.showRecs !== false || profile.showSubscriptions || profile.showSubscribers) && (
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 16 }}>
                {profile.showRecs !== false && (
                <button onClick={() => handleStatClick("recs")} style={{
                  background: "none", border: "none", cursor: "pointer", padding: "0 16px 0 0",
                  display: "flex", flexDirection: "column", gap: 2,
                }}>
                  <span style={{ fontFamily: F, fontSize: 20, fontWeight: 700, color: profileView === "recs" ? T.acc : T.ink }}>{publicItems.length}</span>
                  <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: T.ink3 }}>Recs</span>
                </button>
                )}
                {profile.showSubscriptions && <>
                  {profile.showRecs !== false && <div style={{ width: 1, height: 28, background: T.bdr }} />}
                  <button onClick={() => handleStatClick("subscriptions")} style={{
                    background: "none", border: "none", cursor: "pointer", padding: "0 16px",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <span style={{ fontFamily: F, fontSize: 20, fontWeight: 700, color: profileView === "subscriptions" ? T.acc : T.ink }}>{subscribedToCount}</span>
                    <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: T.ink3 }}>Subscribed to</span>
                  </button>
                </>}
                {profile.showSubscribers && <>
                  {(profile.showRecs !== false || profile.showSubscriptions) && <div style={{ width: 1, height: 28, background: T.bdr }} />}
                  <button onClick={() => handleStatClick("subscribers")} style={{
                    background: "none", border: "none", cursor: "pointer", padding: "0 16px",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <span style={{ fontFamily: F, fontSize: 20, fontWeight: 700, color: profileView === "subscribers" ? T.acc : T.ink }}>{subscriberCount}</span>
                    <span style={{ fontFamily: F, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: T.ink3 }}>Subscribers</span>
                  </button>
                </>}
              </div>
              )}

              {/* Category bar graph */}
              {profileView === "recs" && n > 0 && profile.showRecs !== false && (
                <div style={{ maxWidth: 340, marginTop: 12 }}>
                  <div style={{ display: "flex", height: 4, borderRadius: 4, overflow: "hidden" }}>
                    {topCats.map((cat, i) => (
                      <div key={cat} style={{
                        flex: cc[cat], height: 4,
                        background: CAT_COLORS[cat] || CAT_COLORS.other,
                        borderRadius: i === 0 && topCats.length === 1 ? 4 : i === 0 ? "4px 0 0 4px" : i === topCats.length - 1 ? "0 4px 4px 0" : 0,
                      }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                    {topCats.map(cat => {
                      const c = CAT[cat] || CAT.other;
                      return (
                        <span key={cat} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: T.ink3, fontFamily: F }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: CAT_COLORS[cat] || CAT_COLORS.other }} />
                          {cc[cat]} {c.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI panel — compact bar (mobile only) */}
              {!isDesktop && (
                <div style={{ marginTop: 20 }}>
                  <AIPanelCompact />
                </div>
              )}
            </div>
          </div>

          {/* Right col — AI panel full card (desktop only) */}
          {isDesktop && (
            <div className="hero-right">
              <AIPanelFull />
            </div>
          )}
        </div>
      </div>

      {/* Content section */}
      {profileView === "recs" && profile.showRecs !== false && publicItems.length > 0 && (
        <div style={{ background: T.bg, padding: "16px 20px 40px" }}>
          {/* Category filter pills */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            <button onClick={() => setFilterCat(null)} style={{
              padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 600,
              background: !filterCat ? T.acc : "transparent",
              color: !filterCat ? T.accText : T.ink3,
              border: !filterCat ? "none" : `1px solid ${T.bdr}`,
            }}>All</button>
            {topCats.map(cat => {
              const c = CAT[cat] || CAT.other;
              const active = filterCat === cat;
              return (
                <button key={cat} onClick={() => setFilterCat(active ? null : cat)} style={{
                  padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 600,
                  background: active ? T.acc : "transparent",
                  color: active ? T.accText : T.ink3,
                  border: active ? "none" : `1px solid ${T.bdr}`,
                }}>{c.label}</button>
              );
            })}
          </div>

          {/* Rec list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredItems.map((rec, i) => (
              <div key={rec.id} className="fu" style={{ animationDelay: `${i * .05}s` }}>
                <RecCard
                  item={{ ...rec, date: rec.created_at?.split("T")[0] || rec.date }}
                  onClick={() => onSelectItem(rec)}
                  showCurator={false}
                  onBookmark={!isOwner ? () => savedRecIds?.has(rec.id) ? unsaveRec(rec.id) : saveRec(rec.id) : null}
                  isBookmarked={savedRecIds?.has(rec.id) || false}
                />
              </div>
            ))}
          </div>

          {/* Pull quote */}
          {publicItems[3] && (
            <div style={{ marginTop: 28 }}>
              <div style={{ background: T.s, borderRadius: 16, padding: "22px 20px", borderLeft: `3px solid ${T.acc}` }}>
                <div style={{ fontFamily: S, fontSize: 17, fontStyle: "italic", color: T.ink, lineHeight: 1.55, marginBottom: 8 }}>
                  {publicItems[3]?.context}
                </div>
                <div style={{ fontSize: 12, color: T.ink3, fontFamily: F }}>— on {publicItems[3]?.title}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subscriptions list */}
      {profileView === "subscriptions" && (
        <div style={{ background: T.bg, padding: "16px 20px 40px" }}>
          {subsLoading && (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{ fontSize: 13, color: T.ink3, fontFamily: F }}>Loading...</div>
            </div>
          )}
          {!subsLoading && subsList && subsList.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>{"\u25C6"}</div>
              <p style={{ fontFamily: F, fontSize: 14, color: T.ink3 }}>No subscriptions yet</p>
            </div>
          )}
          {!subsLoading && subsList && subsList.length > 0 && subsList.map(p => (
            <div key={p.id} onClick={() => router.push(`/${p.handle}`)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 4px",
              borderBottom: `1px solid ${T.bdr}`, cursor: "pointer",
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: T.s2,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <span style={{ fontFamily: S, fontSize: 17, color: T.ink, fontWeight: 400 }}>
                  {p.name?.[0] || "?"}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: S, fontSize: 15, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
                  @{p.handle}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscribers list */}
      {profileView === "subscribers" && (
        <div style={{ background: T.bg, padding: "16px 20px 40px" }}>
          {subscribersLoading && (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{ fontSize: 13, color: T.ink3, fontFamily: F }}>Loading...</div>
            </div>
          )}
          {!subscribersLoading && subscribersList && subscribersList.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>{"\u25C6"}</div>
              <p style={{ fontFamily: F, fontSize: 14, color: T.ink3 }}>No subscribers yet</p>
            </div>
          )}
          {!subscribersLoading && subscribersList && subscribersList.length > 0 && subscribersList.map(p => (
            <div key={p.id} onClick={() => router.push(`/${p.handle}`)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 4px",
              borderBottom: `1px solid ${T.bdr}`, cursor: "pointer",
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: T.s2,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <span style={{ fontFamily: S, fontSize: 17, color: T.ink, fontWeight: 400 }}>
                  {p.name?.[0] || "?"}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: S, fontSize: 15, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
                  @{p.handle}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>
    </div>
  );
}
