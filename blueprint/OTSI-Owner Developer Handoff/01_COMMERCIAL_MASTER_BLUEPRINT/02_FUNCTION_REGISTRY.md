# 02 — Engine function and feature registry (build obligations)
Each ID is a build/test unit, not a claim of implementation. For all IDs implement: owner module, TS/Python signature, input/output JSON schema, persistence, authz, observability, unit+integration+e2e tests and specific acceptance evidence. Do not quietly omit IDs.

|ID|Domain|Function|Inputs -> outputs|Primary tables/artifacts|Acceptance test|
|---|---|---|---|---|---|
|F01|Foundation|Tenant registration / invites|user+org -> membership|organizations/users/memberships|cross-tenant forbidden|
|F02|Foundation|Session OIDC/MFA|claims -> access token|users/auth_sessions|issuer/audience verified|
|F03|Foundation|Roles/policy engine|principal/resource -> allow|memberships/access_grants|deny by default|
|F04|Foundation|Project & match CRUD|metadata -> project/match|projects/matches/clubs|audit, version race|
|F05|Foundation|Player registry & roster|metadata -> canonical player|players/match_rosters|concurrent unique ID|
|F06|Ingest|Resumable upload|multipart chunks -> asset|upload_sessions/assets|checksum and resume|
|F07|Ingest|Authorized URL import|URL -> quarantined asset|video_sources/rights_grants|SSRF and redirect validation|
|F08|Ingest|Media probe|asset -> fps/timebase/duration|video_sources/frame_index|VFR PTS correctness|
|F09|Ingest|Transcode/proxy|source -> HLS+proxy+thumbs|assets/proxies|A/V sync within tolerance|
|F10|Ingest|Camera shot boundaries|video -> shots|video_shots|cut segmentation review|
|F11|CV|Visible player detection|frames -> boxes/class/confidence|detections parquet/index|precision/recall gate|
|F12|CV|Ball detection|frames -> ball boxes|detections|small-object benchmark|
|F13|CV|Referee/goalkeeper classes|frames -> classes|detections|confusion matrix|
|F14|CV|Multi-target association|boxes -> tracklets|tracks/track_observations|HOTA/IDF1 gates|
|F15|CV|Camera-motion compensation|frames -> transforms|camera_transforms|calibrated reprojection|
|F16|CV|Occlusion/out-of-frame handling|tracklets -> gap segments|track_gaps|no fabricated positions|
|F17|CV|Cross-shot re-ID|track candidates -> hypotheses|identity_candidates|false re-ID gate|
|F18|CV|Team assignment|appearance -> team hypotheses|identity_candidates|team precision gate|
|F19|CV|Jersey OCR|crop -> jersey hypotheses|identity_candidates|OCR review split|
|F20|CV|Player identification|track+roster -> decision|identity_decisions|unknown on ambiguity|
|F21|CV|Human corrections|review -> versioned decision|identity_reviews|audit/undo|
|F22|Game|Player on-screen presence|trackpts -> intervals|presence_intervals|PTS boundary test|
|F23|Game|Pitch calibration|frame -> homography+error|pitch_calibrations|invalid->not measured|
|F24|Game|Possession hypotheses|ball/player -> episodes|possession_episodes|unknown states|
|F25|Game|Event candidates|observations -> event|events/event_evidence|event PR curves|
|F26|Game|Event review|candidate -> confirmed/rejected|event_reviews|revised history|
|F27|Game|Visible off-ball runs|positions -> runs|movement_segments|no off-screen inference|
|F28|Game|Formations and team shape|positions -> formation windows|tactical_windows|coverage gate|
|F29|Game|Pressing and transition analysis|team trajectories -> windows|tactical_windows|false certainty gate|
|F30|Player|Metrics+uncertainty|evidence -> metric|player_metrics/evidence_records|not measured fallback|
|F31|Player|Heatmap and action maps|calibrated points -> tiles|map_assets|source linkage|
|F32|Player|Scouting profile|events+measurements -> report|player_reports|citations visible|
|F33|Player|Comparisons|matched population -> percentiles|comparison_sets|denominator recorded|
|F34|Search|Frame/event indexing|events -> search docs|search_index|permission filter|
|F35|Search|Cross-match clip query|query -> evidence-bound clips|clips/events|reproducible results|
|F36|Reels|Target selection|player/track -> eligibility|reel_targets|unresolved blocks export|
|F37|Reels|Candidate highlights|verified events -> moments|clip_candidates|coverage rule|
|F38|Reels|Clip trimming|ranges -> clip versions|reel_clips|frame-PTS exact|
|F39|Reels|Timeline graph|clips/layers -> timeline|reel_tracks/reel_items|stable ordering|
|F40|Reels|Spotlight trajectory|track positions -> keyframes|spotlight_keyframes|gap safety|
|F41|Reels|Beam and vignette compositor|frames/keyframes -> frames|render_manifests|pixel/golden test|
|F42|Reels|Multiformat layouts|edits -> 16:9/9:16/1:1|reel_variants|subject within crop|
|F43|Reels|Audio/captions/branding|assets -> composition|reel_items|rights and duration|
|F44|Reels|Render orchestrator|manifest -> job/output|render_jobs/assets|idempotent retry|
|F45|Reels|Render validation|MP4 -> QC assessment|artifact_checks|ffprobe + spot QA|
|F46|Reports|Report builder|player -> JSON/PDF|report_jobs/report_versions|evidence state on figures|
|F47|Delivery|Rights evaluation|user+asset+action -> allow|rights_grants/rights_checks|expired denies|
|F48|Delivery|Signed downloads|artifact -> short URL|share_links/access_log|recheck on open|
|F49|Delivery|Client review|viewer -> comment/approval|review_threads|scoped access|
|F50|Commercial|Plan/price catalog|catalog -> offerings|plans/plan_prices|immutable version|
|F51|Commercial|Checkout portal|tenant -> provider session|billing_customers/subscriptions|entitlements active post webhook|
|F52|Commercial|Usage accounting|job -> meter events|usage_events|exactly-once logically|
|F53|Commercial|Quota enforcement|usage+plan -> authorize|entitlement_grants|concurrent reservation|
|F54|Commercial|Invoices/credits|webhook -> billing state|invoices/credit_ledger|replayed webhook safe|
|F55|Admin|Org/user moderation|admin commands -> audited actions|admin_actions/audit_events|dual-role tests|
|F56|Admin|Model eval/release|model+dataset -> gate|model_evaluations|failed model no deploy|
|F57|Admin|Operations dashboard|telemetry -> summary|job_events/operational_slos|no secrets displayed|
|F58|Governance|Retention and erasure|policy -> deletion queue|retention_jobs|holds respected|
|F59|Governance|Audit & provenance|mutation -> immutable event|audit_events/outbox_events|traceable lineage|
|F60|Governance|Import/export governance|rights matrix -> decision|rights_grants|minor consent blocks|
|F61|Frontend|10 screen state machines|API events -> UI|all relevant|Playwright each screen|
|F62|Infra|Backup restore and DR|snapshot -> restore|backups|restore drill|
|F63|Infra|Security & abuse protection|requests -> rate limit|security_events|OWASP checks|
|F64|Infra|Integration/e2e production smoke|footage -> real MP4/report|full pipeline|golden fixtures|

## Additional advanced roadmap (do not misrepresent as existing)
Near-live inference, predictive expected models, automated spatial 3-D reconstruction, external scouting data marketplaces and generative natural-language video reasoning are independently gated future phases. The v2 commercial release includes fully specified key workflows F01-F64 but may not be called complete until all blocking functions pass the traceability matrix.
