# Curators.AI — Database Schema
Last full audit: 2026-04-10. taste_reads and taste_read_ignores added 2026-04-14. Last column drop: 2026-04-15 (style_summary). Source of truth: `information_schema.columns`.
To refresh: run `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;` in Supabase SQL Editor.

Categories (recommendations + rec_files): watch | listen | read | visit | get | wear | play | other

## profiles
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| name | text | NO |
| handle | text | NO |
| bio | text | YES |
| ai_enabled | boolean | YES |
| accept_requests | boolean | YES |
| show_recs | boolean | YES |
| crypto_enabled | boolean | YES |
| wallet | text | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |
| auth_user_id | uuid | YES |
| onboarding_complete | boolean | YES |
| invited_by | uuid | YES |
| location | text | YES |
| last_seen_at | timestamptz | YES |
| last_action | text | YES |
| last_action_at | timestamptz | YES |
| show_subscriptions | boolean | YES |
| show_subscribers | boolean | YES |
| social_links | jsonb | YES |
| weekly_digest_enabled | boolean | YES |
| new_subscriber_email_enabled | boolean | YES |
| unlimited_invites | boolean | YES |
| feature_flags | jsonb | NO |

Notes: `invited_by` → `profiles.id`. `feature_flags` = JSONB flag map, no active callers as of 2026-04-11.

## recommendations
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | NO |
| title | text | NO |
| category | text | YES |
| context | text | YES |
| tags | ARRAY | YES |
| links | jsonb | YES |
| created_at | timestamptz | YES |
| slug | text | YES |
| visibility | text | YES |
| status | text | YES |
| revision | integer | YES |
| earnable_mode | text | YES |
| depth_score | double precision | YES |
| rec_file_id | text | YES |
| created_via | text | YES |
| image_url | text | YES |

Notes: `rec_file_id` → `rec_files.id` (soft reference, no FK). All 30 production rows have non-null `rec_file_id` as of 2026-04-11. `saved_recs.recommendation_id` FK points here.

`created_via` is analytics-only (not surfaced in UI). Valid values (enforced in application code):
- `quick_capture_url` — Quick capture sheet, URL tab
- `quick_capture_paste` — Quick capture sheet, Paste tab
- `quick_capture_upload` — Quick capture sheet, Upload tab
- `chat_rec_block` — AI-emitted `[REC]{...}[/REC]` block save
- `chat_save_from_url` — `save_rec_from_chat:<url>` action button
- `chat_save_from_image` — `save_image_rec:<sha>` action button
- `chat_save_from_taste_read` — `save_rec_from_taste_read:<url>` action button
- `backfill` — backfill scripts
- `unknown` — fallback when origin cannot be determined

Indexed via partial index `idx_recommendations_created_via` (`WHERE created_via IS NOT NULL`). Pre-existing rows are `NULL`.

`image_url` is populated on new saves going forward (Deploy 1 of 3 for the image_url feature, 2026-04-15). No backfill — pre-2026-04-15 rows are `NULL`. Not yet read by any UI. For URL parses, sourced from the parser's `metadata.thumbnailUrl`. For uploads, set to `artifact://<sha256>` as a durable pointer to the uploaded artifact. `null` for paste mode and for parsers that don't extract an image (Google Maps; Twitter returns a weak profile-avatar value).

## rec_files
| Column | Type | Nullable |
|---|---|---|
| id | text | NO |
| version | integer | NO |
| schema_version | text | NO |
| curator_id | uuid | NO |
| curator_handle | text | NO |
| curator_is_author | boolean | NO |
| created_at | timestamptz | NO |
| updated_at | timestamptz | NO |
| valid_from | date | NO |
| valid_until | date | YES |
| superseded_by | text | YES |
| body_md | text | NO |
| content_sha256 | text | NO |
| source | jsonb | YES |
| work | jsonb | NO |
| curation | jsonb | NO |
| visibility | jsonb | NO |
| provenance | jsonb | NO |
| extraction | jsonb | NO |
| signature | jsonb | YES |
| relationships | jsonb | YES |
| location | jsonb | YES |
| affiliate | jsonb | YES |
| claims | jsonb | YES |

Notes: PK is `(id, version)` composite. `superseded_by` is soft TEXT reference (no FK — self-referencing FK dropped in Deploy 1). `signature/relationships/location/affiliate/claims` reserved for v2+. `work.image_url` is written on new saves (Deploy 1 of 3 for the image_url feature, 2026-04-15) — same semantics as `recommendations.image_url`. Null values are stripped from the `work` object before insert.

## rec_blocks
| Column | Type | Nullable |
|---|---|---|
| block_id | text | NO |
| rec_id | text | NO |
| rec_version | integer | NO |
| block_index | integer | NO |
| block_type | text | NO |
| block_text | text | NO |
| char_start | integer | NO |
| char_end | integer | NO |
| created_at | timestamptz | NO |

Notes: Derived table, rebuilt from `rec_files.body_md`. Never edited directly. Schema exists but not populated as of Deploy 1.

## chat_messages
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | NO |
| role | text | NO |
| text | text | NO |
| captured_rec | jsonb | YES |
| created_at | timestamptz | YES |
| blocks | jsonb | YES |
| interactions | jsonb | YES |
| parsed_content | jsonb | YES |
| rec_refs | jsonb | NO |
| meta | jsonb | YES |

Notes: `parsed_content` = link parse results, re-injected within 5-message window. `rec_refs` = future rec_files references (not yet populated by chat route). `blocks` = content block array (text/MediaEmbed/ActionButtons).

## taste_profiles
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | YES |
| content | text | NO |
| version | integer | NO |
| sources | jsonb | YES |
| generated_at | timestamptz | YES |

Notes: `sources.generated_from` = `'rec_files+recommendations+subscriptions+confirmations'` as of 2026-04-11. `sources.rec_files_enriched` tracks enrichment count.

## taste_confirmations
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | YES |
| type | text | NO |
| observation | text | NO |
| source | text | YES |
| created_at | timestamptz | YES |

Notes: Append-only. `type` values: `taste_read_confirmed`, `correction`, `explicit_statement`, `anti_taste`. `source` field formats: `taste_read:<url>` for confirmations, `taste_read:<key>|refined_from:<original_text>` for corrections, `chat:<msgId>` for legacy pre-v2 rows.

## taste_reads

| Column | Type | Nullable |
| --- | --- | --- |
| id | uuid | NO |
| profile_id | uuid | NO |
| source_url | text | YES |
| rec_file_id | text | YES |
| extraction | text | YES |
| inferences | jsonb | YES |
| states | jsonb | YES |
| refined_texts | jsonb | YES |
| collapsed | boolean | YES |
| dismissed | boolean | YES |
| done | boolean | YES |
| created_at | timestamptz | YES |
| updated_at | timestamptz | YES |

Notes: Partial unique indexes on (profile_id, source_url) WHERE rec_file_id IS NULL and (profile_id, rec_file_id) WHERE rec_file_id IS NOT NULL. RLS enabled. `extraction` is text (not jsonb). `inferences` = [{id, text}] array. `states` = {inferenceId: 'confirmed'|'corrected'|'ignored'} map. `refined_texts` = {inferenceId: string} map.

## taste_read_ignores

| Column | Type | Nullable |
| --- | --- | --- |
| id | uuid | NO |
| profile_id | uuid | NO |
| inference_text | text | YES |
| source_rec_file_id | text | YES |
| source_url | text | YES |
| created_at | timestamptz | YES |

Notes: Append-only log of ignored inferences. curator-only (RLS). source_url links back to taste_reads.source_url for article context.

## invite_codes
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| code | text | NO |
| created_by | uuid | YES |
| used_by | uuid | YES |
| used_at | timestamptz | YES |
| created_at | timestamptz | YES |
| inviter_note | text | YES |
| revoked_at | timestamptz | YES |

Notes: revoked_at is set when curator revokes an unused code. Pending = used_at IS NULL AND revoked_at IS NULL.

## subscriptions
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| subscriber_id | uuid | NO |
| curator_id | uuid | NO |
| subscribed_at | timestamptz | YES |
| unsubscribed_at | timestamptz | YES |
| digest_frequency | text | YES |
| last_notified_at | timestamptz | YES |
| source | text | YES |

Notes: Account-holder subscriptions. Both columns → `profiles.id`. `source`: `'invite' | 'manual'`. Populated April 2026 via ONBOARD-001. `'invite'` indicates row was auto-created on invite redemption.

## subscribers
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| curator_id | uuid | NO |
| email | text | NO |
| tier | text | YES |
| subscribed_at | timestamptz | YES |
| digest_frequency | text | YES |
| last_notified_at | timestamptz | YES |
| unsubscribed_at | timestamptz | YES |

Notes: Email-only, no account. Digest scoped to their specific curator only.

## saved_recs
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| user_id | uuid | NO |
| recommendation_id | uuid | NO |
| saved_at | timestamptz | YES |

Notes: Uses `user_id` (not `profile_id`) — inconsistent, flagged for future migration.

## feedback
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | YES |
| handle | text | YES |
| original_message | text | YES |
| elaboration | text | YES |
| summary | text | YES |
| status | text | YES |
| created_at | timestamptz | YES |

## notification_log
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| type | text | NO |
| recipient_id | uuid | YES |
| recipient_email | text | NO |
| curator_id | uuid | YES |
| rec_ids | ARRAY | YES |
| sent_at | timestamptz | YES |
| status | text | YES |

## email_tokens
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| token | text | NO |
| profile_id | uuid | NO |
| action | text | NO |
| payload | jsonb | YES |
| expires_at | timestamptz | NO |
| used_at | timestamptz | YES |
| created_at | timestamptz | YES |

## link_parse_log
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | YES |
| url | text | NO |
| source_type | text | YES |
| parse_quality | text | NO |
| content_length | integer | YES |
| parse_time_ms | integer | YES |
| error_message | text | YES |
| ai_response_excerpt | text | YES |
| ai_acknowledged_failure | boolean | YES |
| metadata | jsonb | YES |
| created_at | timestamptz | YES |

## agent_jobs
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| profile_id | uuid | YES |
| source_type | text | NO |
| source_url | text | NO |
| status | text | YES |
| raw_data | jsonb | YES |
| extracted_recs | jsonb | YES |
| taste_analysis | jsonb | YES |
| error_message | text | YES |
| started_at | timestamptz | YES |
| completed_at | timestamptz | YES |
| created_at | timestamptz | YES |
| presented_at | timestamptz | YES |

## bundles
| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| curator_id | uuid | NO |
| name | text | NO |
| price | numeric | YES |
| created_at | timestamptz | YES |

## Legacy tables (safe to drop after confirming no RLS/triggers)
- `curator_taste_profiles` — superseded by `taste_profiles`, no active code paths as of 2026-04-10
- `chat_messages_backup_pre_deploy_1` — backup table from Deploy 1, safe to drop
