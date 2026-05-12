// Resolves a usable avatar URL for a profile.
//
// Order of precedence:
//   1. profile.avatar_url             (future column; not present today)
//   2. authUser.raw_user_meta_data.avatar_url   (Google, GitHub OAuth)
//   3. authUser.user_metadata.avatar_url        (client-side shape)
//   4. authUser.raw_user_meta_data.picture      (older OAuth shape)
//   5. authUser.user_metadata.picture           (client-side shape)
//   6. null                                     (caller falls back to initials)
//
// The profiles table has no avatar_url column today. Current testers all
// signed up via email (no OAuth metadata), so this helper returns null
// in every current case. Behavior is forward-looking; when an OAuth
// signup arrives, callers that already pass authUser will render the
// real avatar without further code changes.
export function getProfileAvatarUrl(profile, authUser) {
  if (!profile && !authUser) return null;

  if (profile && typeof profile.avatar_url === "string" && profile.avatar_url) {
    return profile.avatar_url;
  }

  const meta = authUser?.raw_user_meta_data ?? authUser?.user_metadata;
  if (!meta) return null;

  if (typeof meta.avatar_url === "string" && meta.avatar_url) {
    return meta.avatar_url;
  }
  if (typeof meta.picture === "string" && meta.picture) {
    return meta.picture;
  }
  return null;
}
