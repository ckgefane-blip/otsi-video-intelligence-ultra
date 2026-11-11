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
    const COGNATES = new Set([
      "nav.export",
      "pages.reels.title",
      "pages.exports.title",
      "body.analysis.kitTeam1",
      "body.analysis.kitTeam2",
      "body.analysis.match",
      "body.analysis.observations",
      "body.analysis.observationsLabel",
      "body.analysis.provisionalBadge",
      "body.analysis.scoreLabel",
      "body.analysis.tabTeams",
      "body.analysis.tabTracks",
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
    "body.studio.clipWord",
      "body.studio.clipSuggestion",
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
      "body.workspace.eventPluralSuffix",
      "body.workspace.eventSingularSuffix",
      "body.workspace.duelsLabel",
      "body.workspace.experimental",
      "body.workspace.foulsLabel",
      "body.workspace.heatmapMode",
      "body.workspace.heatmapsLabel",
      "body.workspace.heatmapsLive",
      "body.workspace.interceptionsLabel",
      "body.workspace.kitLabel",
      "body.workspace.matchTitleVs",
      "body.workspace.tabCount",
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
      "body.workspace.teamEmpty",
      "body.workspace.teamValue",
      "body.workspace.trackButton",
      "body.workspace.trackLabel",
      "body.workspace.zoomLabel",
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
      expect(same.length, locale).toBeLessThan(100);
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
    expect(bodyKeys("home").length).toBe(43);
    expect(bodyKeys("analysis").length).toBe(208);
    expect(bodyKeys("reels").length).toBe(26);
    expect(bodyKeys("studio").length).toBe(723);
    expect(bodyKeys("reports").length).toBe(17);
    expect(bodyKeys("library").length).toBe(25);
    expect(bodyKeys("exports").length).toBe(23);
    expect(bodyKeys("players").length).toBe(44);
    expect(bodyKeys("upload").length).toBe(435);
    expect(bodyKeys("processing").length).toBe(302);
    // Group B (2026-11-11): Tactical Intelligence + workspace shell.
    expect(bodyKeys("tactics").length).toBe(164);
    expect(bodyKeys("workspace").length).toBe(729);
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
    expect(localeFromLanguageTag("pt-BR")).toBe("en");
    expect(localeFromLanguageTag("zh-CN")).toBe("en");
    expect(localeFromLanguageTag("")).toBe("en");
    expect(localeFromLanguageTag(null)).toBe("en");
    expect(localeFromLanguageTag(undefined)).toBe("en");
  });

  it("isLocale accepts only the five supported codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
  });

  it("the default locale is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getDictionary("en")).toBe(en);
  });
});
