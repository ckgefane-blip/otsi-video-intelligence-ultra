/**
 * Player Profile Intro (ADR-130): the 16:9 opening segment of a generated highlight reel, automatically placed at the very beginning,
 * before the first football clip — and the preview of it in the Reel Builder.
 *
 *   GET    /v1/players/:id/profile-intro[?reel_id=]   the intro's data: identity, profile, measured stats, heat, verified badge
 *
 * What it shows is the selected player's ACTUAL profile: the identity from the one registry (ADR-016), the profile a person recorded
 * (never guessed), and the engine's measured values only (PlayerMeasures, tracks a person confirmed as him). Anything not measured or
 * not confirmed is null here and is shown as "Not measured" / "Unconfirmed" — never invented (ADR-124).
 *
 * The "Player Identity Verified" badge is held to one rule (introVerified, contracts): the player is REGISTERED (his permanent OTSI
 * Player ID issued), a person confirmed at least one track as him in this organization, and — when the intro opens a reel — that
 * reel's targets are still current. Anything less: no badge, and the intro says the identity is unconfirmed.
 *
 * Key Performance Stats: games analysed = videos with a confirmed track; total minutes = minutes seen on camera (never "minutes
 * played"); goals = GOAL events on his confirmed tracks (null while the ball was followed in none of his videos); assists = NOT
 * measured — the engine does not link a pass to a goal (ADR-124). Recent Form has no engine model behind it, so it is always not
 * measured until one exists.
 */
import { Controller, Get, Inject, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import { introVerified, PlayerProfileIntro, PROFILE_INTRO_VERIFIED_RULE, profileIntroSnapshot, ProfileIntroSnapshot, type Reel } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { AnalysisService } from "../analysis/analysis";
import { HeatZonesService } from "../analysis/heat";
import { confirmedTrackCount } from "../playerreport/gate";
import { uuidParam } from "../players/players.controller";
import { playerProfile, PlayersService } from "../players/players.service";

@Injectable()
export class ProfileIntroService {
  constructor(private readonly db: Db, @Inject(PlayersService) private readonly players: PlayersService,
              @Inject(HeatZonesService) private readonly heat: HeatZonesService,
              @Inject(AnalysisService) private readonly analysis: AnalysisService) {}

  /** the reel's player and whether its targets are still current — the same rule ReelsService.get uses (a pinned decision superseded,
   *  or no longer confirmed as this player). */
  private async reelInfo(reelId: string, p: Principal): Promise<{ player_id: string; stale: boolean }> {
    const reel = await this.db.one<RowDataPacket>("SELECT id, player_id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [reelId, p.organizationId]);
    if (!reel) throw notFound("Reel");
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT (ci.decision_id = rt.identity_decision_id AND ci.state = 'CONFIRMED' AND ci.player_id = rt.player_id) AS current
         FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id WHERE rt.reel_id = ?`, [reelId]);
    return { player_id: reel.player_id as string, stale: rows.some((r) => !Number(r.current)) };
  }

  async assemble(playerId: string, p: Principal, reelId: string | null = null): Promise<PlayerProfileIntro> {
    const identity = await this.players.identity(playerId, p);
    let reelStale = false;
    if (reelId) {
      const info = await this.reelInfo(reelId, p);
      if (info.player_id !== playerId) throw new ApiError(422, "REEL_PLAYER_MISMATCH", "That reel follows another player: open the intro for the reel's own player.");
      reelStale = info.stale;
    }
    const profile = (await playerProfile(this.db, playerId, p.organizationId))!;
    if (profile.details?.photo_asset_id) {
      profile.details = { ...profile.details, photo_url: this.analysis.signedUrl(profile.details.photo_asset_id, p.organizationId).url };
    }
    const confirmedTracks = await confirmedTrackCount(this.db, playerId, p.organizationId);
    const m = await this.heat.player(playerId, p);
    const ev = await this.heat.playerEvents(playerId, p);
    const goals = ev.videos > 0 ? ev.items.filter((e) => e.kind === "GOAL").length : null;
    const games = m.videos > 0 ? m.videos : null;
    const minutes = m.seen_s > 0 ? Math.max(1, Math.round(m.seen_s / 60)) : null;
    return PlayerProfileIntro.parse({
      player: identity,
      profile,
      verified: introVerified({ registered: identity.canonical_state === "REGISTERED" || identity.canonical_state === "RETIRED",
        confirmed_tracks: confirmedTracks, reel_stale: reelStale }),
      verified_rule: PROFILE_INTRO_VERIFIED_RULE,
      reel_id: reelId,
      stats: {
        games_analysed: games,
        minutes_seen: minutes,
        goals,
        assists: null,
        basis: m.videos > 0
          ? `Engine measurements on tracks a person confirmed as him: ${m.videos} video${m.videos === 1 ? "" : "s"}, ${Math.round(m.seen_s / 60)} minutes seen on camera.`
          : "No video analysed for him yet: no track is confirmed as him.",
        assists_reason: "Assists are not measured: the engine does not link a pass to a goal (ADR-124).",
      },
      heat: m.heat,
      recent_form: { ratings: null, reason: "Recent form ratings are not measured: the engine has no per-match rating model." },
    });
  }

  /** the photo's rights grant is still in force, or the reason it is not (null when there is no photo to check) */
  async photoRightsProblem(playerId: string, p: Principal): Promise<string | null> {
    return this.players.photoRightsProblem(playerId, p.organizationId);
  }

  /** The render snapshot's `profile` for a reel. startRender calls this after refusing a stale reel, so reel_stale is false here.
   *  Null when the reel's settings have the intro off, or the reel has no player. Refuses the render when the photo's rights are not
   *  in force — the photo is shown in the reel, so it is gated like a logo (ADR-044). */
  async snapshotForRender(reel: Reel, p: Principal): Promise<ProfileIntroSnapshot | null> {
    if (!reel.settings.profile_intro || !reel.player) return null;
    const problem = await this.players.photoRightsProblem(reel.player.player_id, p.organizationId);
    if (problem) throw new ApiError(409, "PHOTO_RIGHTS_MISSING", problem);
    const intro = await this.assemble(reel.player.player_id, p, reel.id);
    return profileIntroSnapshot(intro, await this.players.photoKey(reel.player.player_id, p.organizationId));
  }
}

@Controller("v1/players")
@UseGuards(AuthGuard)
export class ProfileIntroController {
  constructor(private readonly intro: ProfileIntroService) {}

  @Get(":playerId/profile-intro")
  get(@Param("playerId") id: string, @Query("reel_id") reelId: string | undefined, @CurrentPrincipal() p: Principal) {
    const reel = reelId === undefined || reelId === "" ? null : uuidParam(reelId, "Reel");
    return this.intro.assemble(uuidParam(id, "Player"), p, reel);
  }
}
