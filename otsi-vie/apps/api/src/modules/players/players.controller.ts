import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { CreatePlayerRequest, MergePlayersRequest, RegisterPlayerRequest, UpdatePlayerProfileDetailsRequest, UpdatePlayerProfileRequest } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { ApiError, notFound } from "../../core/problem";
import { PlayersService } from "./players.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidParam = (v: string, what: string): string => {
  if (!UUID.test(v)) throw notFound(what);
  return v;
};
export const idempotencyKey = (v: string | undefined): string => {
  if (!v || !/^[A-Za-z0-9_.:-]{8,128}$/.test(v)) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (8-128 safe characters).");
  return v;
};

@Controller("v1/players")
@UseGuards(AuthGuard)
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Post()
  @Roles("OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT")
  async create(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: FastifyReply) {
    const { player, created } = await this.players.create(CreatePlayerRequest.parse(body), idempotencyKey(key), p);
    void res.status(created ? 201 : 200);
    return player;
  }

  @Get()
  search(
    @Query("q") q: string | undefined,
    @Query("role") role: string | undefined,
    @Query("confirmed_only") confirmedOnly: string | undefined,
    @CurrentPrincipal() p: Principal
  ) {
    return this.players.search(q ?? "", p, {
      role,
      confirmedOnly: confirmedOnly === "true" || confirmedOnly === "1",
    });
  }

  @Get("by-otsi-id/:canonicalId")
  byCanonical(@Param("canonicalId") id: string, @CurrentPrincipal() p: Principal) {
    return this.players.byCanonicalId(id, p);
  }

  @Get(":playerId")
  get(@Param("playerId") id: string, @CurrentPrincipal() p: Principal) {
    return this.players.identity(uuidParam(id, "Player"), p);
  }

  @Get(":playerId/profile")
  profile(@Param("playerId") id: string, @CurrentPrincipal() p: Principal) {
    return this.players.profile(uuidParam(id, "Player"), p);
  }

  @Patch(":playerId/profile")
  @Roles("OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT")
  updateProfile(@Param("playerId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.players.updateProfile(uuidParam(id, "Player"), UpdatePlayerProfileRequest.parse(body), p);
  }

  /** ADR-130: the extra profile for the Player Profile Intro (all user-entered, all optional) */
  @Patch(":playerId/profile-details")
  @Roles("OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT")
  updateDetails(@Param("playerId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.players.updateDetails(uuidParam(id, "Player"), UpdatePlayerProfileDetailsRequest.parse(body), p);
  }

  /** ADR-130: the player's photo for the intro — raw PNG/JPEG bytes (at most 512 KB); the rights declaration rides in
   *  x-asset-meta (base64url JSON), following the brand music/video uploads. Returns the updated profile. */
  @Post(":playerId/photo")
  @Roles("OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT")
  uploadPhoto(@Param("playerId") id: string, @Body() body: unknown, @Headers("x-asset-meta") meta: string | undefined,
              @Headers("content-type") declared: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.players.uploadPhoto(uuidParam(id, "Player"), Buffer.isBuffer(body) ? body : undefined, meta, declared, p);
  }

  @Post(":playerId/registration")
  @HttpCode(200)
  @Roles("OWNER", "ADMIN")
  register(@Param("playerId") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.players.register(uuidParam(id, "Player"), RegisterPlayerRequest.parse(body), idempotencyKey(key), p);
  }

  @Post(":playerId/merge")
  @HttpCode(200)
  @Roles("OWNER", "ADMIN")
  merge(@Param("playerId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.players.merge(uuidParam(id, "Player"), MergePlayersRequest.parse(body), p);
  }
}

/** the Players list: where a person records each player's profile before making reels and reports */
@Controller("v1/player-list")
@UseGuards(AuthGuard)
export class PlayerListController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  list(
    @Query("role") role: string | undefined,
    @Query("confirmed_only") confirmedOnly: string | undefined,
    @CurrentPrincipal() p: Principal
  ) {
    return this.players.list(p, {
      role,
      confirmedOnly: confirmedOnly === "true" || confirmedOnly === "1",
    });
  }
}

/** the countries a nationality can be chosen from */
@Controller("v1/countries")
@UseGuards(AuthGuard)
export class CountriesController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  list() {
    return this.players.countries();
  }
}
