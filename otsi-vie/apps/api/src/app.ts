import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { MUSIC_MAX_BYTES, MUSIC_TYPES, VIDEO_MAX_BYTES, VIDEO_TYPES } from "@otsi-vie/contracts";
import { v7 as uuidv7 } from "uuid";
import { CONFIG, Config, loadConfig } from "./core/config";
import { Db } from "./core/db";
import { AuthGuard } from "./core/auth";
import { ProblemFilter } from "./core/problem";
import { AccountController, AccountService, AvatarService, PageModeService } from "./modules/account/account";
import { AnalysisController, AnalysisService } from "./modules/analysis/analysis";
import { AssessmentController, AssessmentService } from "./modules/analysis/assessment";
import { PitchCalibrationController, PitchCalibrationService } from "./modules/analysis/pitch";
import { HeatZonesController, HeatZonesService } from "./modules/analysis/heat";
import { BallMarksController, BallMarksService } from "./modules/analysis/ball";
import { LineupsController, LineupsService } from "./modules/analysis/lineups";
import { MatchPeriodsController, MatchPeriodsService } from "./modules/analysis/periods";
import { MatchEventsController, MatchEventsService } from "./modules/analysis/events";
import { TransitionsController, TransitionsService } from "./modules/analysis/transitions";
import { FormationsController, FormationsService } from "./modules/analysis/formations";
import { PressingController, PressingService } from "./modules/analysis/pressing";
import { EvidenceAuditController, EvidenceAuditService } from "./modules/analysis/evidence";
import { PublicShareController, SharingController, SharingService } from "./modules/sharing/sharing";
import { AssistantController, AssistantService } from "./modules/assistant/assistant";
import { AuditController } from "./modules/audit/audit.controller";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { AuditService } from "./modules/audit/audit.service";
import { MediaController, MediaService } from "./modules/media/media";
import { CountriesController, PlayerListController, PlayersController } from "./modules/players/players.controller";
import { ProjectsController, ProjectsService } from "./modules/projects/projects";
import { LibraryFoldersController, LibraryFoldersService } from "./modules/library/folders";
import { LibraryFactsController, LibraryFactsService } from "./modules/library/facts";
import { RenderEstimateController, RenderEstimateService } from "./modules/reels/estimate";
import { BlocksController, BlocksService } from "./modules/reels/blocks";
import { ExportPresetsController, ExportPresetsService } from "./modules/reels/export-presets";
import { LibraryRemovalController, LibraryRemovalService } from "./modules/library/removal";
import { PlayersService } from "./modules/players/players.service";
import { TrackIdentityController } from "./modules/tracks/track-identity.controller";
import { TrackLinksController, TrackLinksService } from "./modules/tracks/track-links";
import { ReelsController, ReelsService } from "./modules/reels/reels";
import { CrossMatchController, CrossMatchService } from "./modules/reels/cross-match";
import { BrandController, BrandService } from "./modules/reels/brand";
import { ReelTemplatesController, ReelTemplatesService } from "./modules/reels/templates";
import { OrgTemplatesController, OrgTemplatesService } from "./modules/reels/org-templates";
import { ReelHistoryController, ReelHistoryService } from "./modules/reels/edits";
import { PlayerReportController, PlayerReportService } from "./modules/playerreport/playerreport";
import { ProfileIntroController, ProfileIntroService } from "./modules/profileintro/profileintro";
import { ExportsController, ExportsService } from "./modules/exports/exports";
import { ArchiveController, ArchiveService } from "./modules/archive/archive";
import { BeatGridController, BeatGridService } from "./modules/reels/beats";
import { JobsController, JobsService } from "./modules/jobs/jobs";
import { HomeInboxController, HomeInboxService } from "./modules/overview/inbox";
import { TrackIdentityService } from "./modules/tracks/track-identity.service";
import { IdentityEvidenceController, IdentityEvidenceService } from "./modules/tracks/identity-evidence";
import { MatchesController, MatchesService } from "./modules/matches/matches";
import { OverviewController, OverviewService } from "./modules/overview/overview";
import { WorkContextController, WorkContextService } from "./modules/overview/context";
import { SearchController, SearchService } from "./modules/overview/search";
import { SmartBinsController, SmartBinsService } from "./modules/search/bins";
import { NotificationsController, NotificationsService } from "./modules/overview/notifications";
import { MediaInfoController, MediaInfoService } from "./modules/media/media-info";
import { LanesController, LanesService } from "./modules/analysis/lanes";
import { SnapshotsController, SnapshotsService } from "./modules/analysis/snapshots";
import { IdentityImpactController, IdentityImpactService } from "./modules/tracks/identity-impact";
import { CollabController, CollabService } from "./modules/collab/collab";
import { InvitationJoinController, PublicInvitationController, TeamController, TeamService } from "./modules/team/team";
import { TwoStepController, TwoStepService } from "./modules/auth/two-step";
import { WebAuthnController, WebAuthnService } from "./modules/auth/webauthn";
import { AdminController, AdminService } from "./modules/admin/admin";
import { RetentionController, RetentionService } from "./modules/retention/retention";
import { MonitoringController, MonitoringService } from "./modules/monitoring/monitoring";
import { AdminWalletController, WalletController, WalletService } from "./modules/wallet/wallet";
import { AiAnalystController, AiAnalystService } from "./modules/aianalyst/aianalyst";
import { ScoutingPackController, ScoutingPackService } from "./modules/scoutingpack/scouting-pack";

export function appModule(cfg: Config) {
  // local sign-in is mounted only when this API is also the token issuer (ADR-021); with an external OIDC provider it does not exist
  const local = cfg.localAuth ? { controllers: [AuthController, TwoStepController, WebAuthnController], providers: [AuthService, TwoStepService, WebAuthnService] } : { controllers: [], providers: [] };
  @Module({
    controllers: [EvidenceAuditController, FormationsController, PressingController, TransitionsController, AdminController, RetentionController, MonitoringController, WalletController, AdminWalletController, AiAnalystController, AssistantController, AccountController, ProjectsController, MediaController, AnalysisController, AssessmentController, PitchCalibrationController, HeatZonesController, BallMarksController, LineupsController, MatchPeriodsController, MatchEventsController, SharingController, PublicShareController, PlayersController, PlayerListController, CountriesController, TrackIdentityController, CrossMatchController, TrackLinksController, IdentityEvidenceController, MatchesController, ReelsController, BrandController, ReelTemplatesController, ReelHistoryController, PlayerReportController, ProfileIntroController, ExportsController, ScoutingPackController, ArchiveController, BeatGridController, JobsController, HomeInboxController, OverviewController, WorkContextController, SearchController, SmartBinsController, NotificationsController, MediaInfoController, LanesController, SnapshotsController, IdentityImpactController, CollabController, TeamController, PublicInvitationController, InvitationJoinController, AuditController, LibraryRemovalController, LibraryFoldersController, LibraryFactsController, RenderEstimateController, BlocksController, ExportPresetsController, OrgTemplatesController, ...local.controllers],
    providers: [
      { provide: CONFIG, useValue: cfg },
      Db, AuthGuard, WalletService, AiAnalystService, EvidenceAuditService, FormationsService, PressingService, TransitionsService, AdminService, RetentionService, MonitoringService, AssistantService, AccountService, AvatarService, PageModeService, ProjectsService, MediaService, AnalysisService, AssessmentService, PitchCalibrationService, HeatZonesService, BallMarksService, LineupsService, MatchPeriodsService, MatchEventsService, SharingService, PlayersService, TrackIdentityService, TrackLinksService, IdentityEvidenceService, MatchesService, ReelsService, CrossMatchService, BrandService, ReelTemplatesService, ReelHistoryService, PlayerReportService, ProfileIntroService, ExportsService, ScoutingPackService, ArchiveService, BeatGridService, JobsService, HomeInboxService, OverviewService, WorkContextService, SearchService, SmartBinsService, NotificationsService, MediaInfoService, LanesService, SnapshotsService, IdentityImpactService, CollabService, TeamService, AuditService, LibraryRemovalService, LibraryFoldersService, LibraryFactsService, RenderEstimateService, BlocksService, ExportPresetsService, OrgTemplatesService, ...local.providers,
      { provide: APP_FILTER, useClass: ProblemFilter },
    ],
  })
  class AppModule {}
  return AppModule;
}

/** Build the application (used by main.ts and by the HTTP tests, which call it with their own configuration). */
export async function createApp(cfg: Config = loadConfig()): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ genReqId: () => uuidv7(), logger: { level: process.env.OTSI_VIE_LOG_LEVEL ?? "warn" }, bodyLimit: 1_048_576 });
  // upload parts arrive as raw bytes: hand the request stream to the handler (it streams to storage and enforces the exact size itself)
  adapter.getInstance().addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
  // profile photos arrive as raw image bytes (the web app sends a small square; the handler checks the bytes are really that image)
  for (const t of ["image/jpeg", "image/png", "image/webp"]) adapter.getInstance().addContentTypeParser(t, { parseAs: "buffer", bodyLimit: 409_600 }, (_req, body, done) => done(null, body));
  // reel music (ADR-047) arrives as raw audio bytes; the handler checks the bytes are really audio
  for (const t of MUSIC_TYPES) adapter.getInstance().addContentTypeParser(t, { parseAs: "buffer", bodyLimit: MUSIC_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
  // a reel's intro / outro video (ADR-050) arrives as raw bytes; the handler checks the bytes are really a video
  for (const t of VIDEO_TYPES) adapter.getInstance().addContentTypeParser(t, { parseAs: "buffer", bodyLimit: VIDEO_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
  const app = await NestFactory.create<NestFastifyApplication>(appModule(cfg), adapter, { logger: ["error", "warn"] });
  app.enableShutdownHooks();
  // every response names its request, so a user's report of a problem can be matched to logs and audit rows
  app.getHttpAdapter().getInstance().addHook("onSend", async (req, reply) => { void reply.header("x-request-id", String(req.id)); });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
