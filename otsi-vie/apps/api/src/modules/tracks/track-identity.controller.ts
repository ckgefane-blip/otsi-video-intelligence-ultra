import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { IdentityDecisionRequest } from "@otsi-vie/contracts";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { uuidParam } from "../players/players.controller";
import { TrackIdentityService } from "./track-identity.service";

@Controller("v1/tracks")
@UseGuards(AuthGuard)
export class TrackIdentityController {
  constructor(private readonly tracks: TrackIdentityService) {}

  @Get(":trackId/identity")
  identity(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) {
    return this.tracks.identity(uuidParam(id, "Track"), p);
  }

  /** v3 B.6 (ADR-084): who decided what about this track, when and why */
  @Get(":trackId/identity-history")
  history(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) {
    return this.tracks.history(uuidParam(id, "Track"), p);
  }

  @Post(":trackId/identity-decisions")
  @HttpCode(201)
  @Roles("OWNER", "ADMIN", "ANALYST")
  decide(@Param("trackId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.tracks.decide(uuidParam(id, "Track"), IdentityDecisionRequest.parse(body), p);
  }
}
