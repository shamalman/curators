// NOTE: isFeatureEnabled is currently unused — rec_files_writes_enabled flag removed in Deploy X (April 2026). File retained for future flag use.
// lib/features.js
// Feature flag helper. Gates deploy-specific code paths behind per-curator flags.
// See rec-migration-deploy-plan.md §4 for flag inventory.

/**
 * Check whether a feature flag is enabled for a specific profile.
 *
 * @param {object} supabase - Supabase client (server-side recommended for accuracy)
 * @param {string} profileId - UUID of the profile to check
 * @param {string} flagName - Flag name (e.g., 'chat_reads_from_rec_files')
 * @returns {Promise<boolean>} true if the flag is explicitly enabled, false otherwise
 */
export async function isFeatureEnabled(supabase, profileId, flagName) {
  if (!profileId || !flagName) return false;

  const { data, error } = await supabase
    .from('profiles')
    .select('feature_flags')
    .eq('id', profileId)
    .single();

  if (error) {
    console.warn(`[features] Failed to check flag ${flagName} for ${profileId}:`, error.message);
    return false; // fail closed
  }

  if (!data || !data.feature_flags) return false;
  return data.feature_flags[flagName] === true;
}

/**
 * Check multiple flags in one query. Returns an object mapping flag names to booleans.
 * More efficient than multiple isFeatureEnabled calls for the same profile.
 *
 * @param {object} supabase - Supabase client
 * @param {string} profileId - UUID of the profile to check
 * @param {string[]} flagNames - Array of flag names to check
 * @returns {Promise<Record<string, boolean>>}
 */
export async function getFeatureFlags(supabase, profileId, flagNames) {
  const result = Object.fromEntries(flagNames.map((name) => [name, false]));

  if (!profileId || !flagNames?.length) return result;

  const { data, error } = await supabase
    .from('profiles')
    .select('feature_flags')
    .eq('id', profileId)
    .single();

  if (error || !data?.feature_flags) return result;

  for (const name of flagNames) {
    result[name] = data.feature_flags[name] === true;
  }
  return result;
}

/**
 * Check whether a feature flag is enabled for an already-loaded profile object.
 * Use this when the profile is already in scope (e.g., from useCurator() or a parent component).
 * No DB roundtrip. For server-side checks where the profile isn't loaded, use isFeatureEnabled.
 *
 * @param {object} profile - Profile object with featureFlags or feature_flags property
 * @param {string} flagName - Flag name (e.g., 'payout_validation')
 * @returns {boolean} true if the flag is explicitly enabled, false otherwise
 */
export function hasFeature(profile, flagName) {
  if (!profile || !flagName) return false;
  // Support both client-side camelCase (featureFlags) and server-side snake_case (feature_flags) shapes.
  const flags = profile.featureFlags || profile.feature_flags || {};
  return flags[flagName] === true;
}
