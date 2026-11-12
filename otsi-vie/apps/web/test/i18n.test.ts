/**
 * i18n dictionaries and locale detection (ADR-139).
 * Every locale must resolve to a complete dictionary (no missing or empty
 * string), and a missing translation must fall back to English — never to
 * a blank. Locale detection maps a browser language tag to the nearest
 * supported locale, and anything unknown is English.
 *
 * One deliberate exception: body.workspace.eventSingularSuffix is the empty
 * string in en/es/de/fr (the singular form takes no suffix) and "и" in ru;
 * EMPTY_OK below is the only leaf allowed to be empty.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  getDictionary,
  isLocale,
  localeFromLanguageTag,
  mergeDictionary,
  en,
  type Dictionary,
} from "@/lib/i18n";

/** Every leaf path (dot-separated) and value in a nested string object. */
function leaves(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") out.push(...leaves(v as Record<string, unknown>, path));
    else out.push([path, String(v)]);
  }
  return out;
}

function leafAt(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, part) => (cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined), obj);
}

/** Leaves that are deliberately the empty string (see the header comment). */
const EMPTY_OK = new Set(["body.workspace.eventSingularSuffix"]);

describe("dictionaries (ADR-139)", () => {
  it("English is the complete source of truth: every leaf is a non-empty string", () => {
    for (const [path, value] of leaves(en as unknown as Record<string, unknown>)) {
      if (EMPTY_OK.has(path)) continue;
      expect(value.trim().length, path).toBeGreaterThan(0);
    }
  });

  it("every supported locale resolves to a complete dictionary (no missing or empty string)", () => {
    const keys = leaves(en as unknown as Record<string, unknown>).map(([p]) => p);
    expect(keys.length).toBeGreaterThan(30);
    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      for (const path of keys) {
        const value = leafAt(dict as unknown as Record<string, unknown>, path);
        expect(typeof value, `${locale}:${path}`).toBe("string");
        if (EMPTY_OK.has(path)) continue;
        expect((value as string).trim().length, `${locale}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("a locale that does not translate a key falls back to the English string", () => {
    const merged = mergeDictionary(en, { nav: { home: "Главная" } });
    expect(merged.nav.home).toBe("Главная");
    expect(merged.nav.upload).toBe("Upload");
    expect(merged.pages.home.subtitle).toBe(en.pages.home.subtitle);
  });

  it("every supported locale has a native name for the switcher", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_NAMES[locale].trim().length).toBeGreaterThan(0);
    }
    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.ru).toBe("Русский");
    expect(LOCALE_NAMES.es).toBe("Español");
    expect(LOCALE_NAMES.de).toBe("Deutsch");
    expect(LOCALE_NAMES.fr).toBe("Français");
  });

  it("the four translations actually differ from English (they are translations, not copies)", () => {
    // Words that are legitimately identical to English in a locale: genuine
    // cognates / loanwords in the video-editing and football domain ("Zoom",
    // "Clip", "Audio", "Standard", "Team", "Match", "Corner" in French…),
    // product terms ("Reels", "Media Bin", "Smart Bin"), keyboard key names
    // ("Escape"), and placeholder-only templates ("{a} · {b}", "{n} fps").
    // Every same-as-English leaf must be on this list — a new one means a
    // translation was left as an English copy. Group B (2026-11-11) added
    // the studio/workspace/tactics cognates below.
    // Group D (2026-11-11) added the library/reports/players/matches
    // cognates below: genuine loanwords/cognates ("Video", "Status",
    // "Tags", "Match", "Reels", "clip", "Pass", "Design"), placeholder-only
    // templates ("{a} · {b}", "{a} / 10") and metric abbreviations ("xG", "xA").
    const COGNATES = new Set([
      "desktop.tierPro",                       // the paid tier's name, same in every language
      "desktop.tokens",
      "desktop.tierEnterprise",                // tier names and their limits: product names, the same in every language
      "desktop.uploadTiersLine",
      "desktop.pause",                         // German "Pause", French "Pause"
      "desktop.licence",                       // French "Licence"                        // Spanish uses the English word, as the wallet pages already do
      "body.library.assetAria",
      "body.library.binGroupMoments",
      "body.library.binNameLabel",
      "body.library.clipsMany",
      "body.library.clipsOne",
      "body.library.colStatus",
      "body.library.groupMoments",
      "body.library.kindLabelMatch",
      "body.library.kindLabelReel",
      "body.library.kindLabelVideo",
      "body.library.kindPluralVideo",
      "body.library.kindVideos",
      "body.library.matchSubFallback",
      "body.library.metaTags",
      "body.library.overlayHeatmaps",
      "body.library.pagesAria",
      "body.library.panelTabsAria",
      "body.library.permEditor",
      "body.library.permManager",
      "body.library.projectDescAria",
      "body.library.tabExports",
      "body.library.tabReels",
      "body.library.tableStatus",
      "body.library.teamsNoneLabel",
      "body.library.withReelsMany",
      "body.library.withReelsOne",
      "body.matches.positionAria",
      "body.matches.positionPlaceholder",
      "body.matches.provisionalShort",
      "body.matches.roleStarter",
      "body.reports.actFilterPasses",
      "body.reports.assessRatingValue",
      "body.reports.assessTraits",
      "body.reports.cmpPasses",
      "body.reports.coverTime",
      "body.reports.criterionScore",
      "body.reports.designTitle",
      "body.reports.evFilterPasses",
      "body.reports.evLengthM",
      "body.reports.evPass",
      "body.reports.heatModeTouches",
      "body.reports.kpiPasses",
      "body.reports.kpiSprints",
      "body.reports.kpiXa",
      "body.reports.kpiXg",
      "body.reports.minSuffix",
      "body.reports.notesHeading",
      "body.reports.notesTags",
      "body.reports.playerInDossier",
      "body.reports.railHeatmaps",
      "body.reports.railPerformance",
      "body.reports.spCorner",
      "body.reports.spPenalty",
      "body.library.colType",
      "body.library.deleteNounMatch",
      "body.library.deleteNounReel",
      "body.library.filterTeam",
      "body.library.filterTeamsNone",
      "body.library.filterType",
      "body.library.newProjectDescAria",
      "body.library.rowInFolder",
      "body.library.rowTitle",
      "body.library.selMatch",
      "body.library.selNameAria",
      "body.library.selTags",
      "body.library.tabCountAria",
      "body.library.tableHeadStatus",
      "body.library.tableHeadType",
      "body.library.trashWithReelMany",
      "body.library.trashWithReelOne",
      "body.analysis.kitTeam1",
      "body.analysis.kitTeam2",
      "body.analysis.match",
      "body.analysis.observations",
      "body.analysis.observationsLabel",
      "body.analysis.provisionalBadge",
      "body.analysis.scoreLabel",
      "body.analysis.tabTeams",
      "body.analysis.tabTracks",
      "body.exportstage.archiveVideoBlocked",
      "body.exportstage.aspectSocial",
      "body.exportstage.aspectVertical",
      "body.exportstage.brandSummaryIntro",
      "body.exportstage.brandSummaryLogo",
      "body.exportstage.bundleHeatTitle",
      "body.exportstage.chapterClip",
      "body.exportstage.choiceReel11",
      "body.exportstage.choiceReel169",
      "body.exportstage.choiceReel45",
      "body.exportstage.choiceReel916",
      "body.exportstage.frame30",
      "body.exportstage.frame60",
      "body.exportstage.frameSrc",
      "body.exportstage.interchangeClipMany",
      "body.exportstage.interchangeClipOne",
      "body.exportstage.loudnessBroadcast",
      "body.exportstage.loudnessOnline",
      "body.exportstage.loudnessSocial",
      "body.exportstage.outputLabel",
      "body.exportstage.outputReel",
      "body.exportstage.packLink",
      "body.exportstage.packTitle",
      "body.exportstage.preflightFmt",
      "body.exportstage.profileArchive",
      "body.exportstage.profileReel",
      "body.exportstage.profileScout",
      "body.exportstage.profileSocial",
      "body.exportstage.qualityStandard",
      "body.exportstage.reportPreviewDescTime",
      "body.exportstage.resolution4k",
      "body.exportstage.resolutionHd",
      "body.exportstage.roleAdmin",
      "body.exportstage.roleAnalyst",
      "body.exportstage.roleClient",
      "body.exportstage.roleEditor",
      "body.exportstage.shareStatePublic",
      "body.exportstage.summaryRowDate",
      "body.exportstage.tabsBranding",
      "body.exportstage.tabsExport",
      "body.exportstage.tagsLabel",
      "body.exportstage.viewManifest",
      "body.exportstage.viewOtio",
      "body.library.name",
      "body.library.team",
      "body.players.position",
      "body.players.provisional",
      "body.processing.ball",
      "body.processing.detectorLabel",
      "body.processing.estimateMinutes",
      "body.processing.estimateSeconds",
      "body.processing.eventPasses",
      "body.processing.fpsOption",
      "body.processing.machineHeader",
      "body.processing.position",
      "body.processing.profileStandardLabel",
      "body.processing.videoFallback",
      "body.reels.aspectFeed",
      "body.reels.aspectStories",
      "body.reels.len3min",
      "body.reels.len5min",
      "body.reels.len90s",
      "body.reels.minutesSeen",
      "body.reels.reelListClipsMany",
      "body.reels.reelListClipsOne",
      "body.reels.sourceUpTo180",
      "body.reels.sourceUpTo300",
      "body.reels.stepClips",
      "body.reels.stepClipsMany",
      "body.reels.stepClipsOne",
      "body.reels.stepRender",
      "body.reels.stepSpotlight",
      "body.reelstage.aspectInstagram",
      "body.reelstage.aspectReels",
      "body.reelstage.aspectYouTube",
      "body.reelstage.badgePossible",
      "body.reelstage.clipAria",
      "body.reelstage.clipEditorTitle",
      "body.reelstage.clipListFallback",
      "body.reelstage.detailVisible",
      "body.reelstage.draftDurMin",
      "body.reelstage.draftDurMinSec",
      "body.reelstage.draftDurSec",
      "body.reelstage.durationHour",
      "body.reelstage.durationHourMin",
      "body.reelstage.durationMin",
      "body.reelstage.durationMinSec",
      "body.reelstage.durationSec",
      "body.reelstage.durS",
      "body.exportstage.pickerClipsOne",
      "body.exportstage.pickerClipsMany",      "body.reelstage.estimateRange",
      "body.reelstage.inspectorAria",
      "body.reelstage.introCheck",
      "body.reelstage.introLabel",
      "body.reelstage.laneAudio",
      "body.reelstage.laneSpotlightShort",
      "body.reelstage.laneText",
      "body.reelstage.outroCheck",
      "body.reelstage.outroLabel",
      "body.reelstage.pauseBtn",
      "body.reelstage.positionDash",
      "body.reelstage.presetStandardName",
      "body.reelstage.redoTitle",
      "body.reelstage.stepExport",
      "body.reelstage.stepHitLabel",
      "body.reelstage.summaryBrandIntro",
      "body.reelstage.summaryBrandOutro",
      "body.reelstage.summaryBranding",
      "body.reelstage.summaryClips",
      "body.reelstage.summaryClipsMany",
      "body.reelstage.summaryClipsOne",
      "body.reelstage.summaryOverlays",
      "body.reelstage.summarySpotlight",
      "body.reelstage.tagCorner",
      "body.reelstage.tagPass",
      "body.reelstage.tagPenalty",
      "body.reelstage.tagVisible",
      "body.reelstage.teamDash",
      "body.reelstage.undoTitle",
      "body.studio.aspectFeed",
      "body.studio.aspectPortrait45",
      "body.studio.aspectVertical916",
      "body.studio.assets",
      "body.studio.audioLabel",
      "body.studio.audioTab",
      "body.studio.beatLabel",
      "body.studio.blockClipsMany",
      "body.studio.blockClipsOne",
      "body.studio.brandingLabel",
      "body.studio.clipIndex",
      "body.studio.clipMeter",
      "body.studio.clipOfTotal",
      "body.studio.clipSuggestion",
      "body.studio.clipWord",
      "body.studio.colorLabel",
      "body.studio.colourCyan",
      "body.studio.corner",
      "body.studio.drawCount",
      "body.studio.dualOff",
      "body.studio.dualOn",
      "body.studio.exportLabel",
      "body.studio.filterLabel",
      "body.studio.inspectorAria",
      "body.studio.interceptionWord",
      "body.studio.introLabel",
      "body.studio.linearLabel",
      "body.studio.lockNormal",
      "body.studio.lockStrict",
      "body.studio.lockTolerant",
      "body.studio.logoLabel",
      "body.studio.logoName",
      "body.studio.lookBroadcast",
      "body.studio.lookFilm",
      "body.studio.lookSection",
      "body.studio.lookSet",
      "body.studio.lookValue",
      "body.studio.lookWord",
      "body.studio.loudnessOnline",
      "body.studio.loudnessSocial",
      "body.studio.markerLabel",
      "body.studio.matchRow",
      "body.studio.mediaBinLower",
      "body.studio.mediaBinTab",
      "body.studio.nameCaptionPlayer",
      "body.studio.neutralValue",
      "body.studio.notesRow",
      "body.studio.outroLabel",
      "body.studio.passLabel",
      "body.studio.passLengthM",
      "body.studio.peakMeter",
      "body.studio.penalty",
      "body.studio.reelsPicker",
      "body.studio.refClip",
      "body.studio.refClipN",
      "body.studio.saturation",
      "body.studio.smartBinOption",
      "body.studio.soundtrackLabel",
      "body.studio.styleLabel",
      "body.studio.suggestionsCheck",
      "body.studio.suggestionsCount",
      "body.studio.suggestionsLabel",
      "body.studio.tabNotYet",
      "body.studio.tagsRow",
      "body.studio.transitionsCount",
      "body.studio.transitionsSection",
      "body.studio.trimEdgeIn",
      "body.studio.trimEdgeOut",
      "body.studio.trimLabel",
      "body.studio.vectorscopeLabel",
      "body.studio.warmValue",
      "body.studio.zoomLabel2",
      "body.studio.zoomSection",
      "body.tactics.phaseLabel",
      "body.tactics.possessionLabel",
      "body.tactics.transitionsMenu",
      "body.upload.no",
      "body.upload.source",
      "body.workspace.centreLabel",
      "body.workspace.chipFouls",
      "body.workspace.chipInterceptions",
      "body.workspace.chipPasses",
      "body.workspace.cornerLower",
      "body.workspace.coverageMoments",
      "body.workspace.decidedBy",
      "body.workspace.distanceKpiTitle",
      "body.workspace.duelsLabel",
      "body.workspace.eventPluralSuffix",
      "body.workspace.eventSingularSuffix",
      "body.workspace.experimental",
      "body.workspace.foulsLabel",
      "body.workspace.heatmapMode",
      "body.workspace.heatmapsLabel",
      "body.workspace.heatmapsLive",
      "body.workspace.interceptionsLabel",
      "body.workspace.kitLabel",
      "body.workspace.matchTitleVs",
      "body.workspace.metricClip",
      "body.workspace.metricClips",
      "body.workspace.metricDistance",
      "body.workspace.metricPasses",
      "body.workspace.metricTouches",
      "body.workspace.noBtn",
      "body.workspace.passDetail",
      "body.workspace.passesNoun",
      "body.workspace.penaltyLower",
      "body.workspace.personLabel",
      "body.workspace.positionDash",
      "body.workspace.positionsLabel",
      "body.workspace.pressingLine",
      "body.workspace.shotSpeedKmh",
      "body.workspace.tabCount",
      "body.workspace.teamEmpty",
      "body.workspace.teamValue",
      "body.workspace.trackButton",
      "body.workspace.trackLabel",
      "body.workspace.zoomLabel",
      "nav.export",
      "pages.exports.title",
      "pages.reels.title",
      "webauthn.passkeysTitle",
      // Group E (2026-11-11): Admin / Settings / Wallet / Shell / Home / Auth
      // cognates below — genuine loanwords and football/infra terms shared
      // with English ("Reels", "Export", "Upload", "Pause", "Normal", "App",
      // "Pro", "Code", "Match", "Workers", "Videos", "Governance", "Status",
      // "Adapter", "Details", "Name", "Analyst", "Scout", "Editor", "Actor",
      // "Tokens", "Naira (₦)"), severity codes ("INFO"), technical names
      // ("CPU / DirectML"), placeholder-only templates (", {a}", "{a}: {b}"),
      // punctuation ("—"), a query-syntax placeholder and the OTSI Player ID.
      "body.home.heroMetricPasses",
      "body.home.heroPlayerAriaId",
      "body.admin.severityInfo",
      "body.admin.metricWorkers",
      "body.admin.metricVideos",
      "body.admin.sysGpuFallback",
      "body.admin.auditColActor",
      "body.admin.auditColDetails",
      "body.admin.colAdapter",
      "body.admin.colStatus",
      "body.admin.gatesCatGovernance",
      "body.admin.gatesCatInfrastructure",
      "body.admin.modelAbsent",
      "body.admin.modelsColVersion",
      "body.admin.navInterface",
      "body.admin.releaseColGate",
      "body.admin.releaseColName",
      "body.admin.releaseColStatus",
      "body.admin.releaseGateG06Name",
      "body.admin.queueActiveWord",
      "body.admin.gdprAction",
      "body.admin.gdprColDate",
      "body.admin.auditColAction",
      "body.admin.workerOnline",
      "body.admin.workerCountOne",
      "body.settings.emailPlaceholder",
      "body.settings.roleSummaryLine",
      "body.settings.roleEditor",
      "body.settings.roleAnalyst",
      "body.settings.roleScout",
      "body.settings.colName",
      "body.settings.colEmail",
      "body.wallet.tokensUnit",
      "body.wallet.currencyNaira",
      "body.wallet.colTokens",
      "body.wallet.billingTopUpTokensPh",
      "body.wallet.billingWalletSection",
      "body.wallet.billingLedgerAria",
      "body.wallet.colNote",
      "body.shell.modePro",
      "body.shell.groupReel",
      "body.shell.groupPages",
      "body.shell.groupMoment",
      "body.shell.ctxNonePlayer",
      "body.shell.ctxProvisional",
      "body.shell.ctxOtsiId",
      "body.shell.ctxReel",
      "body.shell.ctxMatch",
      "body.shell.jobPriorityNormal",
      "body.shell.jobPause",
      "body.shell.keyGroupApp",
      "body.shell.assistantCommandPh",
      "body.shell.pageNameUpload",
      "body.shell.pageNameExport",
      "body.shell.scopeExports",
      "body.shell.paletteAssistant",
      "body.shell.notifTitle",
      "body.shell.notifTitleFallback",
      "body.auth.code",
      "body.auth.inviteTitle",
    ]);
    for (const locale of ["ru", "es", "de", "fr"] as const) {
      const dict = getDictionary(locale);
      const same = leaves(en as unknown as Record<string, unknown>).filter(
        ([path, value]) => leafAt(dict as unknown as Record<string, unknown>, path) === value,
      );
      const unexpected = same.filter(([path]) => !COGNATES.has(path));
      expect(unexpected, locale).toEqual([]);
      // Tripwire against a batch left as English copies: the COGNATES list
      // above is the binding check (every same leaf must be listed there);
      // this cap just bounds the dictionary's legitimate loanword surface
      // (de/fr share ~80 words with English in this UI domain). Group B
      // (2026-11-11) raised it from 60 to 100 as the studio keys landed.
      // Group C (2026-11-11) raised it from 100 to 180 as the Reel Builder
      // and Export keys landed: ~1,100 new keys, many of them loanwords
      // (Clip, Reel, Spotlight), formats (4K, MP4, fps, LUFS) and role names.
      // Group D (2026-11-11) raised it from 180 to 210 as the Library /
      // Reports / Players / Matches keys landed: ~970 new keys, many of them
      // football loanwords in French (Match, Reels, Passes, Corner, Penalty,
      // Performance, Heatmaps) and placeholder-only templates. French is the
      // highest at 193.
      // Group E (2026-11-11) raised it from 210 to 250 as the Admin /
      // Settings / Wallet / Shell / Home / Auth keys landed: ~710 new keys,
      // many of them admin/infra loanwords (Workers, Videos, Governance,
      // Status, Adapter, Export, Upload, Pause, Normal, App, Pro, Code,
      // Match, Reels, Moments, Pages, Notifications, Assistant) and
      // placeholder-only templates. French is the highest at 235, German
      // at 216, Spanish at 167, Russian at 36.
      expect(same.length, locale).toBeLessThan(250);
      expect(dict.nav.home).not.toBe(en.nav.home);
      expect(dict.common.language).not.toBe(en.common.language);
    }
  });
});

describe("page bodies (ADR-139 follow-up)", () => {
  const bodyKeys = (group: string) =>
    leaves(en as unknown as Record<string, unknown>).map(([p]) => p).filter((p) => p.startsWith(`body.${group}.`));

  it("covers the in-scope page groups, with the expected key counts", () => {
    expect(leaves(en as unknown as Record<string, unknown>).length).toBeGreaterThan(200);
    expect(bodyKeys("home").length).toBe(97);
    expect(bodyKeys("analysis").length).toBe(208);
    expect(bodyKeys("reels").length).toBe(212);
    expect(bodyKeys("studio").length).toBe(723);
    expect(bodyKeys("reports").length).toBe(338);
    expect(bodyKeys("library").length).toBe(650);
    expect(bodyKeys("exports").length).toBe(32);
    expect(bodyKeys("players").length).toBe(110);
    expect(bodyKeys("matches").length).toBe(108);
    expect(bodyKeys("upload").length).toBe(435);
    expect(bodyKeys("processing").length).toBe(302);
    // Group B (2026-11-11): Tactical Intelligence + workspace shell.
    expect(bodyKeys("tactics").length).toBe(164);
    expect(bodyKeys("workspace").length).toBe(729);
    // Group C (2026-11-11): Reel Builder + Export pages.
    expect(bodyKeys("reelstage").length).toBe(443);
    expect(bodyKeys("exportstage").length).toBe(515);
    // Group E (2026-11-11): Admin + Settings + Wallet + Shell + Auth, and
    // the Home extension (KPI cards, capability tiles, hero metrics, hero
    // player card, review inbox, active jobs).
    expect(bodyKeys("admin").length).toBe(220);
    expect(bodyKeys("settings").length).toBe(74);
    expect(bodyKeys("wallet").length).toBe(90);
    expect(bodyKeys("shell").length).toBe(244);
    expect(bodyKeys("auth").length).toBe(88);
  });

  it("the body strings are actually translated in each locale (spot checks)", () => {
    const ru = getDictionary("ru").body;
    expect(ru.home.viewAll).toBe("Смотреть все");
    expect(ru.reels.saveProject).toBe("Сохранить проект");
    expect(ru.players.position).toBe("Позиция");
    expect(ru.studio.chooseReel).toBe("Выберите ролик");
    const es = getDictionary("es").body;
    expect(es.home.viewAll).toBe("Ver todo");
    expect(es.reports.notMeasured).toBe("No medido");
    const de = getDictionary("de").body;
    expect(de.reels.saveProject).toBe("Projekt speichern");
    expect(de.exports.deliverToClient).toBe("An Kunden liefern");
    const fr = getDictionary("fr").body;
    expect(fr.reports.choosePlayer).toBe("Choisissez un joueur");
    expect(fr.library.newProject).toBe("Nouveau projet");
    expect(fr.upload.supportedFormats).toBe("Formats pris en charge");
    const ruUp = getDictionary("ru").body.upload;
    expect(ruUp.recentUploads).toBe("Недавние загрузки");
    expect(ruUp.dragDropMatch).toBe("Перетащите сюда видео матча");
    expect(getDictionary("ru").body.processing.jobs).toBe("Задания");
    expect(getDictionary("es").body.upload.createProject).toBe("Crear proyecto");
    expect(getDictionary("de").body.processing.jobs).toBe("Aufträge");
    // Group B (2026-11-11): Analysis workspace, workspace shell, Tactical, Clip Studio.
    const ruB = getDictionary("ru").body;
    expect(ruB.analysis.noFinishedAnalysis).toBe("Завершённого анализа пока нет: событий нет.");
    expect(ruB.analysis.identityReview).toBe("Проверка личности");
    expect(ruB.workspace.videoPlayer).toBe("Видеоплеер");
    expect(ruB.tactics.pressingDefense).toBe("Прессинг и оборона");
    expect(ruB.studio.mediaBinTab).toBe("Медиабин");
    const esB = getDictionary("es").body;
    expect(esB.analysis.samePersonElsewhereQ).toBe("¿La misma persona en otro lugar?");
    expect(esB.workspace.videoAnalysis).toBe("Análisis de vídeo");
    expect(esB.tactics.playerComparison).toBe("Comparación de jugadores");
    expect(esB.studio.undo).toBe("Deshacer");
    const deB = getDictionary("de").body;
    expect(deB.processing.stepIdentity).toBe("Identitätsbelege");
    expect(deB.workspace.tacticalView).toBe("Taktische Ansicht");
    expect(deB.tactics.pressingMap).toBe("Pressingkarte");
    expect(deB.studio.exportLabel).toBe("Export");
    const frB = getDictionary("fr").body;
    expect(frB.analysis.identityReview).toBe("Vérification d’identité");
    expect(frB.workspace.pitchCalibration).toBe("Calibrage du terrain");
    expect(frB.tactics.playerComparison).toBe("Comparaison de joueurs");
    expect(frB.studio.templates).toBe("Modèles");
    // Group C (2026-11-11): Reel Builder + Export pages.
    const ruC = getDictionary("ru").body;
    expect(ruC.reels.loadFailed).toBe("Ролик не удалось загрузить.");
    expect(ruC.reels.clubLeague).toBe("Клуб и лига");
    expect(ruC.reelstage.stepSelectPlayer).toBe("Выбрать игрока");
    expect(ruC.reelstage.themeBest).toBe("Его лучшие действия");
    expect(ruC.exportstage.workflowTitle).toBe("Экспорт и доставка");
    const esC = getDictionary("es").body;
    expect(esC.reels.stepProfileIntro).toBe("Intro del perfil");
    expect(esC.reelstage.stepSelectPlayer).toBe("Seleccionar jugador");
    expect(esC.exportstage.workflowTitle).toBe("Exportación y entrega");
    const deC = getDictionary("de").body;
    expect(deC.reels.loadFailed).toBe("Das Reel konnte nicht geladen werden.");
    expect(deC.reelstage.themeBest).toBe("Seine besten Aktionen");
    expect(deC.exportstage.workflowTitle).toBe("Export & Lieferung");
    const frC = getDictionary("fr").body;
    expect(frC.reels.clubLeague).toBe("Club et championnat");
    // Group D spot checks (2026-11-11): Library / Reports / Players / Matches.
    const ruD = getDictionary("ru").body;
    const esD = getDictionary("es").body;
    const deD = getDictionary("de").body;
    const frD = getDictionary("fr").body;
    expect(ruD.library.manageAccess).toBe("Управление доступом");
    expect(ruD.players.photoTooBig).toBe("Изображение больше 512 КБ.");
    expect(ruD.reports.kpiXg).toBe("xG");
    expect(esD.matches.addBtn).toBe("Añadir");
    expect(esD.library.tabReels).toBe("Reels");
    expect(deD.players.detailsSaved).toBe("Profildetails gespeichert.");
    expect(deD.reports.coverTime).toBe("{a} · {b}");
    expect(frD.reports.notesTitle).toBe("Notes et étiquettes · {a}");
    expect(frD.library.clipsOne).toBe("1 clip");
    expect(frD.matches.rosterSaved).toBe("Effectif enregistré.");
    expect(frC.reelstage.stepSelectPlayer).toBe("Sélectionner le joueur");
    expect(frC.exportstage.workflowTitle).toBe("Export et livraison");
    // Group E spot checks (2026-11-11): Admin / Settings / Wallet / Shell / Home / Auth.
    const ruE = getDictionary("ru").body;
    const esE = getDictionary("es").body;
    const deE = getDictionary("de").body;
    const frE = getDictionary("fr").body;
    expect(ruE.admin.title).toBe("Консоль администратора");
    expect(ruE.settings.teamTitle).toBe("Команда и роли");
    expect(ruE.wallet.title).toBe("Кошелёк токенов");
    expect(ruE.shell.jobsTitle).toBe("Задания");
    expect(ruE.auth.signIn).toBe("Войти");
    expect(ruE.home.kpiMatchesAnalyzed).toBe("Матчей проанализировано");
    expect(esE.admin.title).toBe("Consola de administración");
    expect(esE.settings.teamTitle).toBe("Equipo y roles");
    expect(esE.wallet.title).toBe("Billetera de tokens");
    expect(esE.shell.paletteTitle).toBe("Buscar y comandos");
    expect(esE.auth.signIn).toBe("Iniciar sesión");
    expect(esE.home.kpiMatchesAnalyzed).toBe("Partidos analizados");
    expect(deE.admin.title).toBe("Admin-Konsole");
    expect(deE.shell.paletteTitle).toBe("Suche und Befehle");
    expect(deE.auth.signIn).toBe("Anmelden");
    expect(deE.home.kpiMatchesAnalyzed).toBe("Analysierte Spiele");
    expect(frE.settings.teamTitle).toBe("Équipe et rôles");
    expect(frE.wallet.title).toBe("Portefeuille de jetons");
    expect(frE.shell.paletteTitle).toBe("Recherche et commandes");
    expect(frE.auth.signIn).toBe("Se connecter");
    expect(frE.home.kpiMatchesAnalyzed).toBe("Matchs analysés");
  });

  it("a body key missing from a partial still falls back to English", () => {
    const merged = mergeDictionary(en, { body: { home: { viewAll: "Смотреть все" } } });
    expect(merged.body.home.viewAll).toBe("Смотреть все");
    expect(merged.body.home.recentMatches).toBe(en.body.home.recentMatches);
    expect(merged.body.reels.saveProject).toBe(en.body.reels.saveProject);
  });
});

describe("locale detection", () => {
  it("maps a BCP 47 tag to the nearest supported locale", () => {
    expect(localeFromLanguageTag("ru-RU")).toBe("ru");
    expect(localeFromLanguageTag("ru")).toBe("ru");
    expect(localeFromLanguageTag("es-MX")).toBe("es");
    expect(localeFromLanguageTag("es")).toBe("es");
    expect(localeFromLanguageTag("de-DE")).toBe("de");
    expect(localeFromLanguageTag("fr-FR")).toBe("fr");
    expect(localeFromLanguageTag("en-US")).toBe("en");
    expect(localeFromLanguageTag("en")).toBe("en");
  });

  it("an unsupported or missing tag is English, never an error", () => {
    expect(localeFromLanguageTag("pt-BR")).toBe("pt");               // Portuguese added (owner, 2026-11-12)
    expect(localeFromLanguageTag("it-IT")).toBe("en");
    expect(localeFromLanguageTag("zh-CN")).toBe("en");
    expect(localeFromLanguageTag("")).toBe("en");
    expect(localeFromLanguageTag(null)).toBe("en");
    expect(localeFromLanguageTag(undefined)).toBe("en");
  });

  it("isLocale accepts only the six supported codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
  });

  it("the default locale is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getDictionary("en")).toBe(en);
  });
});
