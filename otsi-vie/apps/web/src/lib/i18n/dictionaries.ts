/**
 * Translation dictionaries for the OTSI VIE web app (ADR-139).
 *
 * English (`en`) is the source of truth and the fallback: every string has an
 * English value. Each other locale is a deep partial — a key it does not
 * translate falls back to the English string, never to a blank or a guess.
 * `getDictionary` merges a locale over English, so the result is always a
 * complete dictionary.
 *
 * Scope: the strings the app actually shows — the ten navigation labels, the
 * ten page titles + subtitles (from `lib/pages.ts`, the approved specs), the
 * common actions, the app-shell strings (search, language), and the page
 * bodies: the core headings, buttons, tables, dialogs and empty states of
 * Home, Analysis, Reel Builder, Clip Studio, Player Reports, Library,
 * Export and Players (ADR-139 follow-up, 2026-11-11). Player,
 * club and league names, OTSI PINs and other proper nouns are never
 * translated and never appear here. The bodies of the remaining pages
 * (Upload, AI Processing, Tactical) and the deeper dialogs adopt these
 * strings in a later follow-up; what is not in the dictionary stays English.
 */
import type { Locale } from "./locales";

export interface Dictionary {
  nav: {
    home: string;
    upload: string;
    processing: string;
    analysis: string;
    tactical: string;
    reels: string;
    studio: string;
    reports: string;
    library: string;
    export: string;
  };
  common: {
    search: string;
    signOut: string;
    save: string;
    cancel: string;
    close: string;
    back: string;
    continue: string;
    loading: string;
    retry: string;
    language: string;
  };
  pages: {
    home: { title: string; subtitle: string };
    upload: { title: string; subtitle: string };
    processing: { title: string; subtitle: string };
    analysis: { title: string; subtitle: string };
    tactical: { title: string; subtitle: string };
    reels: { title: string; subtitle: string };
    studio: { title: string; subtitle: string };
    reports: { title: string; subtitle: string };
    library: { title: string; subtitle: string };
    exports: { title: string; subtitle: string };
  };
  shell: {
    searchAndCommands: string;
    searchHint: string;
    language: string;
  };
  /**
   * Page bodies (ADR-139 follow-up): the headings, buttons, tables, dialogs
   * and empty states of the main app pages. Same rules as the rest of the
   * dictionary — English is the source of truth, the other locales are
   * partial and fall back to English, and proper nouns (OTSI VIE, Spotlight
   * Composer, player/club/league names, OTSI PINs, "Reels" in ES/DE/FR)
   * stay untranslated. Match/player data and reel on-screen labels are
   * never in here: a reel is a finished artefact.
   */
  body: {
    home: {
      heroEyebrow: string;
      heroTitleA: string;
      heroTitleB: string;
      heroSubtitle: string;
      heroSubtitleB: string;
      uploadVideo: string;
      pasteLink: string;
      featuredReel: string;
      recentMatches: string;
      sampleReels: string;
      viewAll: string;
      reviewInbox: string;
      activeJobs: string;
      howItWorks: string;
      howItWorksSubtitle: string;
      howItWorksSubtitleB: string;
      capabilities: string;
      trustStrip: string;
      trustedPartners: string;
      noMatchesYet: string;
      matchesListedHere: string;
      matchesLoadFailed: string;
      tapRetry: string;
      noReelsYet: string;
      reelsAppearHere: string;
      couldntLoadReels: string;
      reelsReadFailed: string;
      featuredLoadFailed: string;
      noFeaturedReel: string;
      publishedReelsHere: string;
      stepUploadDesc: string;
      stepAnalyze: string;
      stepAnalyzeDescA: string;
      stepAnalyzeDescB: string;
      stepSelect: string;
      stepSelectDescA: string;
      stepSelectDescB: string;
      stepGenerate: string;
      stepGenerateDescA: string;
      stepGenerateDescB: string;
      stepExport: string;
      stepExportDescA: string;
      stepExportDescB: string;
    };
    analysis: {
      match: string;
      visualOverlays: string;
      teamFilter: string;
      timeRange: string;
      chooseVideo: string;
      players: string;
      clickBox: string;
      createReel: string;
      openInReelBuilder: string;
      allEvents: string;
      tracksPresence: string;
      lineups: string;
      noFinishedAnalysis: string;
    };
    reels: {
      reelInfo: string;
      reelTitle: string;
      reelDescription: string;
      duration: string;
      matches: string;
      music: string;
      aspectRatio: string;
      backToReels: string;
      spotlightControls: string;
      playerTargeting: string;
      branding: string;
      output: string;
      saveProject: string;
      previewRender: string;
      videoClips: string;
      history: string;
      addMoments: string;
      projectSaved: string;
      unsavedChanges: string;
      notSaved: string;
      openReel: string;
      allMatches: string;
      reelsNotLoaded: string;
      renderReel: string;
      backToEditing: string;
      startRender: string;
    };
    studio: {
      chooseReel: string;
      noReelsYet: string;
      makeInReelBuilder: string;
      reelsLoadFailed: string;
      backToReelBuilder: string;
      undo: string;
      redo: string;
      keyboardShortcuts: string;
      assets: string;
      searchBin: string;
      templates: string;
      suggestedMoments: string;
      clipDetails: string;
      selectClip: string;
      reelPreview: string;
      zoomIn: string;
      zoomOut: string;
    };
    reports: {
      choosePlayer: string;
      searchPlayers: string;
      noPlayerFound: string;
      playersNotLoaded: string;
      identityEvidence: string;
      keyMetrics: string;
      roleSummary: string;
      notMeasured: string;
      noTraits: string;
      editProfile: string;
      heatmap: string;
      actionMap: string;
      eventTimeline: string;
      scoutingReport: string;
      noScoutNotes: string;
      viewFullReport: string;
      playersListLink: string;
    };
    library: {
      newProject: string;
      searchLibrary: string;
      allAssets: string;
      type: string;
      name: string;
      team: string;
      competition: string;
      createdBy: string;
      loadingLibrary: string;
      noSavedSearches: string;
      trash: string;
      trashEmpty: string;
      events: string;
      selectAsset: string;
      openInAnalysis: string;
      download: string;
      rename: string;
      share: string;
      sendToClient: string;
      smartBins: string;
      newSmartBin: string;
      createFolder: string;
      clearFilters: string;
      saveSearch: string;
      deletedItems: string;
    };
    exports: {
      projectSummary: string;
      openReelToExport: string;
      exportSettings: string;
      renderProgress: string;
      noRenderJobs: string;
      renderQueueNotLoaded: string;
      deliverToClient: string;
      outputPreset: string;
      fileFormat: string;
      resolution: string;
      frameRate: string;
      quality: string;
      includeBranding: string;
      clientName: string;
      clientEmail: string;
      message: string;
      noneYet: string;
      shareableLink: string;
      noLinksYet: string;
      exportPresets: string;
      newPreset: string;
      savePreset: string;
      downloadAll: string;
    };
    players: {
      subtitle: string;
      allPositions: string;
      confirmedRolesOnly: string;
      searchPlaceholder: string;
      noMatch: string;
      noPlayersYet: string;
      position: string;
      nationality: string;
      preferredFoot: string;
      birthDate: string;
      teamNumber: string;
      notOnTeamSheet: string;
      provisional: string;
      confirmed: string;
      confirm: string;
      saving: string;
      savedConfirmed: string;
      couldNotSave: string;
      profileDetails: string;
      hideProfileDetails: string;
      nothingEntered: string;
      someEntered: string;
      height: string;
      weight: string;
      club: string;
      league: string;
      intlCountry: string;
      intlCaps: string;
      intlGoals: string;
      summary: string;
      strengths: string;
      addStrength: string;
      photo: string;
      noPhotoYet: string;
      uploadPhoto: string;
      uploading: string;
      photoSaved: string;
      saveDetails: string;
      readOnly: string;
      openReport: string;
      noOtsiId: string;
      notRecorded: string;
      heightError: string;
      weightError: string;
    };
  };
}

/** A dictionary that may leave any leaf untranslated (it then falls back to English). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const en: Dictionary = {
  nav: {
    home: "Home",
    upload: "Upload",
    processing: "Processing",
    analysis: "Analysis",
    tactical: "Tactical",
    reels: "Reel Builder",
    studio: "Clip Studio",
    reports: "Player Report",
    library: "Library",
    export: "Export",
  },
  common: {
    search: "Search",
    signOut: "Sign out",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    back: "Back",
    continue: "Continue",
    loading: "Loading…",
    retry: "Try again",
    language: "Language",
  },
  pages: {
    home: { title: "Home", subtitle: "Turn football video into insights" },
    upload: {
      title: "Upload",
      subtitle: "Bring your football footage into OTSI VIE. Ingest, probe and prepare it for analysis.",
    },
    processing: {
      title: "AI Processing",
      subtitle: "From raw video to actionable insights: detection, tracking, identity, events and indexing.",
    },
    analysis: { title: "Analysis", subtitle: "Video analysis workspace" },
    tactical: {
      title: "Tactical Intelligence",
      subtitle: "Go beyond the video: tactical patterns, team behaviour and player insights.",
    },
    reels: {
      title: "Reels",
      subtitle: "Spotlight Composer: cinematic, evidence-backed player reels.",
    },
    studio: {
      title: "Clip Studio",
      subtitle: "Create, edit and assemble reels on a frame-accurate timeline.",
    },
    reports: { title: "Reports", subtitle: "Evidence-backed player report" },
    library: {
      title: "Library",
      subtitle: "Manage reels, reports, matches, exports and folders; search and collaborate.",
    },
    exports: {
      title: "Export",
      subtitle: "Render, brand and deliver video insights to your team and clients.",
    },
  },
  shell: {
    searchAndCommands: "Search and commands (Ctrl+K)",
    searchHint: "Search matches, players, reels and projects, or run a command (Ctrl+K)",
    language: "Language",
  },
  body: {
    home: {
      heroEyebrow: "TURN FOOTBALL VIDEO INTO INSIGHTS",
      heroTitleA: "Professional Football",
      heroTitleB: "Video Intelligence",
      heroSubtitle: "Upload matches, analyze every player, create reels and share",
      heroSubtitleB: "insights — built for analysts, scouts and agencies.",
      uploadVideo: "Upload Video",
      pasteLink: "Paste Link",
      featuredReel: "FEATURED REEL",
      recentMatches: "Recent Matches",
      sampleReels: "Sample Reels",
      viewAll: "View All",
      reviewInbox: "Review inbox",
      activeJobs: "Active jobs",
      howItWorks: "How It Works",
      howItWorksSubtitle: "From video to valuable insights",
      howItWorksSubtitleB: "in minutes.",
      capabilities: "Platform Capabilities",
      trustStrip: "Built for clubs, academies and scouts",
      trustedPartners: "TRUSTED PARTNERS",
      noMatchesYet: "No matches analysed yet",
      matchesListedHere: "Uploaded matches will be listed here",
      matchesLoadFailed: "Couldn't load recent matches",
      tapRetry: "Tap to retry",
      noReelsYet: "No reels yet",
      reelsAppearHere: "Generated reels appear here",
      couldntLoadReels: "Couldn't load reels",
      reelsReadFailed: "Reels could not be read. Retry",
      featuredLoadFailed: "Couldn't load reels — tap to retry",
      noFeaturedReel: "No featured reel",
      publishedReelsHere: "Published reels appear here",
      stepUploadDesc: "Upload a match or training video",
      stepAnalyze: "Analyze with AI",
      stepAnalyzeDescA: "Our AI automatically detects players,",
      stepAnalyzeDescB: "tracks the ball and extracts key events.",
      stepSelect: "Select a Player",
      stepSelectDescA: "Choose any player and filter by",
      stepSelectDescB: "actions, phase, or game context.",
      stepGenerate: "Generate Reel",
      stepGenerateDescA: "Create a professional highlight reel",
      stepGenerateDescB: "with custom filters and branding.",
      stepExport: "Export & Share",
      stepExportDescA: "Download a detailed PDF report",
      stepExportDescB: "or share reels with your team.",
    },
    analysis: {
      match: "Match",
      visualOverlays: "Visual Overlays",
      teamFilter: "Team Filter",
      timeRange: "Time Range",
      chooseVideo: "Choose a match video first.",
      players: "Players",
      clickBox: "Click a box on the video or a player in the list.",
      createReel: "Create Highlight Reel",
      openInReelBuilder: "Open in Reel Builder ›",
      allEvents: "All Events",
      tracksPresence: "Tracks & Presence",
      lineups: "Lineups",
      noFinishedAnalysis: "No finished analysis yet: no events.",
    },
    reels: {
      reelInfo: "Reel Info",
      reelTitle: "Title",
      reelDescription: "Description (optional)",
      duration: "Duration",
      matches: "Matches",
      music: "Music",
      aspectRatio: "Aspect Ratio",
      backToReels: "Back to Reels",
      spotlightControls: "Spotlight Controls",
      playerTargeting: "Player Targeting",
      branding: "Branding",
      output: "Output",
      saveProject: "Save Project",
      previewRender: "Preview Render",
      videoClips: "Video Clips",
      history: "History",
      addMoments: "Add moments to build the reel",
      projectSaved: "Project saved.",
      unsavedChanges: "Unsaved changes",
      notSaved: "The project was not saved.",
      openReel: "Open a reel",
      allMatches: "All matches",
      reelsNotLoaded: "Reels could not be loaded.",
      renderReel: "Render this reel?",
      backToEditing: "Back to editing",
      startRender: "Start render",
    },
    studio: {
      chooseReel: "Choose a reel",
      noReelsYet: "No reels yet.",
      makeInReelBuilder: "Make one in the Reel Builder",
      reelsLoadFailed: "The reels could not be loaded.",
      backToReelBuilder: "Back to the Reel Builder",
      undo: "Undo",
      redo: "Redo",
      keyboardShortcuts: "Keyboard shortcuts",
      assets: "Assets",
      searchBin: "Search clips, players, tags...",
      templates: "Templates",
      suggestedMoments: "Suggested moments",
      clipDetails: "Clip Details",
      selectClip: "Select a clip to see what the engine found in it.",
      reelPreview: "Reel preview",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
    },
    reports: {
      choosePlayer: "Choose a player",
      searchPlayers: "Search by name…",
      noPlayerFound: "No player found.",
      playersNotLoaded: "The players could not be loaded.",
      identityEvidence: "Identity & Evidence",
      keyMetrics: "Key metrics",
      roleSummary: "Player Role & Summary",
      notMeasured: "Not measured",
      noTraits: "No traits recorded",
      editProfile: "Edit profile ›",
      heatmap: "Heatmap",
      actionMap: "Action Map",
      eventTimeline: "Event Timeline (All Actions)",
      scoutingReport: "Scouting Report",
      noScoutNotes: "No scout notes recorded.",
      viewFullReport: "View Full Report",
      playersListLink: "Players list: enter their profiles ›",
    },
    library: {
      newProject: "New Project",
      searchLibrary: "Search projects, players, tags, or content…",
      allAssets: "All assets",
      type: "Type",
      name: "Name",
      team: "Team",
      competition: "Competition",
      createdBy: "Created By",
      loadingLibrary: "Loading the Library…",
      noSavedSearches: "No saved searches yet",
      trash: "Trash",
      trashEmpty: "The Trash is empty.",
      events: "Events",
      selectAsset: "Select an asset with a video in the table.",
      openInAnalysis: "Open in Analysis",
      download: "Download",
      rename: "Rename",
      share: "Share",
      sendToClient: "Send to Client",
      smartBins: "Smart Bins",
      newSmartBin: "New Smart Bin",
      createFolder: "Create folder",
      clearFilters: "Clear Filters",
      saveSearch: "Save Current Search",
      deletedItems: "Deleted items",
    },
    exports: {
      projectSummary: "Project Summary",
      openReelToExport: "Open a reel to export",
      exportSettings: "Export Settings",
      renderProgress: "Render Progress",
      noRenderJobs: "No render jobs queued",
      renderQueueNotLoaded: "The render queue could not be loaded.",
      deliverToClient: "Deliver to Client",
      outputPreset: "Output Preset",
      fileFormat: "File Format",
      resolution: "Resolution",
      frameRate: "Frame Rate",
      quality: "Quality",
      includeBranding: "Include Branding",
      clientName: "Client name",
      clientEmail: "Client email",
      message: "Message (optional)",
      noneYet: "None yet.",
      shareableLink: "Shareable Link",
      noLinksYet: "No links yet.",
      exportPresets: "Export presets",
      newPreset: "New preset",
      savePreset: "Save preset",
      downloadAll: "Download All",
    },
    players: {
      subtitle: "Enter what you know about each player once. Reels and reports show it. The video never fills these in.",
      allPositions: "All positions",
      confirmedRolesOnly: "Confirmed roles only",
      searchPlaceholder: "Search by name or OTSI Player ID…",
      noMatch: "No player matches the search.",
      noPlayersYet: "No players yet. Add players to a match team sheet, or confirm who a player is in Analysis.",
      position: "Position",
      nationality: "Nationality",
      preferredFoot: "Preferred foot",
      birthDate: "Birth date",
      teamNumber: "Team · No. (from the team sheet)",
      notOnTeamSheet: "Not on a team sheet yet",
      provisional: "Provisional",
      confirmed: "✓ Confirmed",
      confirm: "Confirm",
      saving: "Saving…",
      savedConfirmed: "Saved & confirmed.",
      couldNotSave: "Could not save. Try again.",
      profileDetails: "Profile details for the intro",
      hideProfileDetails: "Hide profile details for the intro",
      nothingEntered: "Nothing entered yet — the intro shows “Not entered”.",
      someEntered: "Some details entered — shown on the Player Profile Intro as “Entered by user”.",
      height: "Height (cm)",
      weight: "Weight (kg)",
      club: "Current club (only where no team sheet names one)",
      league: "League",
      intlCountry: "International country",
      intlCaps: "International caps",
      intlGoals: "International goals",
      summary: "Player summary (at most 600 characters)",
      strengths: "Player strengths (up to 6, each at most 60 characters)",
      addStrength: "+ Add strength",
      photo: "Photo (shown on the intro)",
      noPhotoYet: "No photo yet.",
      uploadPhoto: "Upload photo",
      uploading: "Uploading…",
      photoSaved: "Photo saved.",
      saveDetails: "Save profile details",
      readOnly: "Created by another organization: read only",
      openReport: "Open report ›",
      noOtsiId: "Provisional: no OTSI Player ID yet",
      notRecorded: "Not recorded",
      heightError: "Height is 100–250 cm.",
      weightError: "Weight is 30–200 kg.",
    },
  },
};

export const ru: DeepPartial<Dictionary> = {
  nav: {
    home: "Главная",
    upload: "Загрузка",
    processing: "Обработка",
    analysis: "Анализ",
    tactical: "Тактика",
    reels: "Конструктор роликов",
    studio: "Клип-студия",
    reports: "Отчёт игрока",
    library: "Библиотека",
    export: "Экспорт",
  },
  common: {
    search: "Поиск",
    signOut: "Выйти",
    save: "Сохранить",
    cancel: "Отмена",
    close: "Закрыть",
    back: "Назад",
    continue: "Продолжить",
    loading: "Загрузка…",
    retry: "Повторить",
    language: "Язык",
  },
  pages: {
    home: { title: "Главная", subtitle: "Превращайте футбольное видео в аналитику" },
    upload: {
      title: "Загрузка",
      subtitle: "Загрузите футбольные записи в OTSI VIE. Импорт, проверка и подготовка к анализу.",
    },
    processing: {
      title: "ИИ-обработка",
      subtitle: "От сырого видео к полезной аналитике: обнаружение, трекинг, идентификация, события и индексация.",
    },
    analysis: { title: "Анализ", subtitle: "Рабочее место видеоанализа" },
    tactical: {
      title: "Тактическая аналитика",
      subtitle: "Больше, чем видео: тактические схемы, поведение команды и аналитика игроков.",
    },
    reels: {
      title: "Ролики",
      subtitle: "Spotlight Composer: кинематографичные ролики игроков, подкреплённые данными.",
    },
    studio: {
      title: "Клип-студия",
      subtitle: "Создавайте, редактируйте и собирайте ролики на покадровой шкале времени.",
    },
    reports: { title: "Отчёты", subtitle: "Отчёт об игроке, подкреплённый данными" },
    library: {
      title: "Библиотека",
      subtitle: "Управляйте роликами, отчётами, матчами, экспортом и папками; ищите и работайте совместно.",
    },
    exports: {
      title: "Экспорт",
      subtitle: "Рендеринг, брендирование и доставка видеоаналитики вашей команде и клиентам.",
    },
  },
  shell: {
    searchAndCommands: "Поиск и команды (Ctrl+K)",
    searchHint: "Ищите матчи, игроков, ролики и проекты или выполните команду (Ctrl+K)",
    language: "Язык",
  },
  body: {
    home: {
      heroEyebrow: "ПРЕВРАЩАЙТЕ ФУТБОЛЬНОЕ ВИДЕО В АНАЛИТИКУ",
      heroTitleA: "Профессиональный футбол",
      heroTitleB: "Видеоаналитика",
      heroSubtitle: "Загружайте матчи, анализируйте каждого игрока, создавайте ролики и делитесь",
      heroSubtitleB: "аналитикой — для аналитиков, скаутов и агентств.",
      uploadVideo: "Загрузить видео",
      pasteLink: "Вставить ссылку",
      featuredReel: "ИЗБРАННЫЙ РОЛИК",
      recentMatches: "Недавние матчи",
      sampleReels: "Примеры роликов",
      viewAll: "Смотреть все",
      reviewInbox: "Входящие на проверку",
      activeJobs: "Активные задачи",
      howItWorks: "Как это работает",
      howItWorksSubtitle: "От видео к ценной аналитике",
      howItWorksSubtitleB: "за считанные минуты.",
      capabilities: "Возможности платформы",
      trustStrip: "Создано для клубов, академий и скаутов",
      trustedPartners: "НАДЁЖНЫЕ ПАРТНЁРЫ",
      noMatchesYet: "Матчей пока не проанализировано",
      matchesListedHere: "Загруженные матчи появятся здесь",
      matchesLoadFailed: "Не удалось загрузить недавние матчи",
      tapRetry: "Нажмите, чтобы повторить",
      noReelsYet: "Роликов пока нет",
      reelsAppearHere: "Созданные ролики появятся здесь",
      couldntLoadReels: "Не удалось загрузить ролики",
      reelsReadFailed: "Не удалось прочитать ролики. Повторить",
      featuredLoadFailed: "Не удалось загрузить ролики — нажмите, чтобы повторить",
      noFeaturedReel: "Избранного ролика нет",
      publishedReelsHere: "Опубликованные ролики появятся здесь",
      stepUploadDesc: "Загрузите видео матча или тренировки",
      stepAnalyze: "Анализ с помощью ИИ",
      stepAnalyzeDescA: "Наш ИИ автоматически обнаруживает игроков,",
      stepAnalyzeDescB: "отслеживает мяч и выделяет ключевые события.",
      stepSelect: "Выберите игрока",
      stepSelectDescA: "Выберите любого игрока и фильтруйте по",
      stepSelectDescB: "действиям, фазе или контексту игры.",
      stepGenerate: "Создайте ролик",
      stepGenerateDescA: "Создайте профессиональный ролик с лучшими моментами",
      stepGenerateDescB: "с собственными фильтрами и брендингом.",
      stepExport: "Экспорт и отправка",
      stepExportDescA: "Скачайте подробный PDF-отчёт",
      stepExportDescB: "или поделитесь роликами с командой.",
    },
    analysis: {
      match: "Матч",
      visualOverlays: "Визуальные слои",
      teamFilter: "Фильтр по команде",
      timeRange: "Временной диапазон",
      chooseVideo: "Сначала выберите видео матча.",
      players: "Игроки",
      clickBox: "Нажмите на рамку на видео или на игрока в списке.",
      createReel: "Создать ролик с лучшими моментами",
      openInReelBuilder: "Открыть в Конструкторе роликов ›",
      allEvents: "Все события",
      tracksPresence: "Треки и присутствие",
      lineups: "Составы",
      noFinishedAnalysis: "Завершённого анализа пока нет: событий нет.",
    },
    reels: {
      reelInfo: "О ролике",
      reelTitle: "Название",
      reelDescription: "Описание (необязательно)",
      duration: "Длительность",
      matches: "Матчи",
      music: "Музыка",
      aspectRatio: "Соотношение сторон",
      backToReels: "Назад к роликам",
      spotlightControls: "Настройки спотлайта",
      playerTargeting: "Выбор игрока",
      branding: "Брендинг",
      output: "Вывод",
      saveProject: "Сохранить проект",
      previewRender: "Предпросмотр рендера",
      videoClips: "Видеоклипы",
      history: "История",
      addMoments: "Добавьте моменты, чтобы собрать ролик",
      projectSaved: "Проект сохранён.",
      unsavedChanges: "Несохранённые изменения",
      notSaved: "Проект не сохранён.",
      openReel: "Открыть ролик",
      allMatches: "Все матчи",
      reelsNotLoaded: "Не удалось загрузить ролики.",
      renderReel: "Отрендерить этот ролик?",
      backToEditing: "Назад к редактированию",
      startRender: "Начать рендер",
    },
    studio: {
      chooseReel: "Выберите ролик",
      noReelsYet: "Роликов пока нет.",
      makeInReelBuilder: "Создайте ролик в Конструкторе роликов",
      reelsLoadFailed: "Не удалось загрузить ролики.",
      backToReelBuilder: "Назад в Конструктор роликов",
      undo: "Отменить",
      redo: "Вернуть",
      keyboardShortcuts: "Горячие клавиши",
      assets: "Материалы",
      searchBin: "Поиск клипов, игроков, тегов…",
      templates: "Шаблоны",
      suggestedMoments: "Предложенные моменты",
      clipDetails: "Детали клипа",
      selectClip: "Выберите клип, чтобы увидеть, что нашёл движок.",
      reelPreview: "Предпросмотр ролика",
      zoomIn: "Приблизить",
      zoomOut: "Отдалить",
    },
    reports: {
      choosePlayer: "Выберите игрока",
      searchPlayers: "Поиск по имени…",
      noPlayerFound: "Игрок не найден.",
      playersNotLoaded: "Не удалось загрузить игроков.",
      identityEvidence: "Личность и доказательства",
      keyMetrics: "Ключевые показатели",
      roleSummary: "Роль и описание игрока",
      notMeasured: "Не измерено",
      noTraits: "Качества не записаны",
      editProfile: "Редактировать профиль ›",
      heatmap: "Тепловая карта",
      actionMap: "Карта действий",
      eventTimeline: "Хроника событий (все действия)",
      scoutingReport: "Скаутский отчёт",
      noScoutNotes: "Скаутских заметок нет.",
      viewFullReport: "Полный отчёт",
      playersListLink: "Список игроков: заполните их профили ›",
    },
    library: {
      newProject: "Новый проект",
      searchLibrary: "Поиск проектов, игроков, тегов и материалов…",
      allAssets: "Все материалы",
      type: "Тип",
      name: "Имя",
      team: "Команда",
      competition: "Турнир",
      createdBy: "Автор",
      loadingLibrary: "Загрузка библиотеки…",
      noSavedSearches: "Сохранённых поисков пока нет",
      trash: "Корзина",
      trashEmpty: "Корзина пуста.",
      events: "События",
      selectAsset: "Выберите в таблице материал с видео.",
      openInAnalysis: "Открыть в Анализе",
      download: "Скачать",
      rename: "Переименовать",
      share: "Поделиться",
      sendToClient: "Отправить клиенту",
      smartBins: "Умные подборки",
      newSmartBin: "Новая умная подборка",
      createFolder: "Создать папку",
      clearFilters: "Сбросить фильтры",
      saveSearch: "Сохранить текущий поиск",
      deletedItems: "Удалённые материалы",
    },
    exports: {
      projectSummary: "Сводка проекта",
      openReelToExport: "Откройте ролик для экспорта",
      exportSettings: "Настройки экспорта",
      renderProgress: "Прогресс рендера",
      noRenderJobs: "Задач рендера в очереди нет",
      renderQueueNotLoaded: "Не удалось загрузить очередь рендера.",
      deliverToClient: "Доставить клиенту",
      outputPreset: "Пресет вывода",
      fileFormat: "Формат файла",
      resolution: "Разрешение",
      frameRate: "Частота кадров",
      quality: "Качество",
      includeBranding: "Включить брендинг",
      clientName: "Имя клиента",
      clientEmail: "Email клиента",
      message: "Сообщение (необязательно)",
      noneYet: "Пока нет.",
      shareableLink: "Ссылка для доступа",
      noLinksYet: "Ссылок пока нет.",
      exportPresets: "Пресеты экспорта",
      newPreset: "Новый пресет",
      savePreset: "Сохранить пресет",
      downloadAll: "Скачать всё",
    },
    players: {
      subtitle: "Запишите то, что знаете о каждом игроке, один раз. Ролики и отчёты покажут это. Видео эти данные не заполняет.",
      allPositions: "Все позиции",
      confirmedRolesOnly: "Только подтверждённые роли",
      searchPlaceholder: "Поиск по имени или OTSI Player ID…",
      noMatch: "Ни один игрок не подходит под поиск.",
      noPlayersYet: "Игроков пока нет. Добавьте игроков в заявку на матч или подтвердите личность игрока в Анализе.",
      position: "Позиция",
      nationality: "Гражданство",
      preferredFoot: "Ведущая нога",
      birthDate: "Дата рождения",
      teamNumber: "Команда · № (из заявки)",
      notOnTeamSheet: "Пока нет в заявке",
      provisional: "Предварительно",
      confirmed: "✓ Подтверждено",
      confirm: "Подтвердить",
      saving: "Сохранение…",
      savedConfirmed: "Сохранено и подтверждено.",
      couldNotSave: "Не удалось сохранить. Попробуйте снова.",
      profileDetails: "Детали профиля для вступления",
      hideProfileDetails: "Скрыть детали профиля для вступления",
      nothingEntered: "Пока ничего не введено — во вступлении будет «Не введено».",
      someEntered: "Некоторые детали введены — во вступлении Player Profile Intro они показаны как «Введено пользователем».",
      height: "Рост (см)",
      weight: "Вес (кг)",
      club: "Текущий клуб (только если заявка его не называет)",
      league: "Лига",
      intlCountry: "Страна (сборная)",
      intlCaps: "Матчи за сборную",
      intlGoals: "Голы за сборную",
      summary: "Описание игрока (до 600 символов)",
      strengths: "Сильные стороны игрока (до 6, каждая до 60 символов)",
      addStrength: "+ Добавить сильную сторону",
      photo: "Фото (показывается во вступлении)",
      noPhotoYet: "Фото пока нет.",
      uploadPhoto: "Загрузить фото",
      uploading: "Загрузка…",
      photoSaved: "Фото сохранено.",
      saveDetails: "Сохранить детали профиля",
      readOnly: "Создано другой организацией: только чтение",
      openReport: "Открыть отчёт ›",
      noOtsiId: "Предварительно: OTSI Player ID пока нет",
      notRecorded: "Не записано",
      heightError: "Рост — 100–250 см.",
      weightError: "Вес — 30–200 кг.",
    },
  },
};

export const es: DeepPartial<Dictionary> = {
  nav: {
    home: "Inicio",
    upload: "Subir",
    processing: "Procesando",
    analysis: "Análisis",
    tactical: "Táctica",
    reels: "Creador de reels",
    studio: "Estudio de clips",
    reports: "Informe del jugador",
    library: "Biblioteca",
    export: "Exportar",
  },
  common: {
    search: "Buscar",
    signOut: "Cerrar sesión",
    save: "Guardar",
    cancel: "Cancelar",
    close: "Cerrar",
    back: "Atrás",
    continue: "Continuar",
    loading: "Cargando…",
    retry: "Reintentar",
    language: "Idioma",
  },
  pages: {
    home: { title: "Inicio", subtitle: "Convierte el vídeo de fútbol en información" },
    upload: {
      title: "Subir",
      subtitle: "Trae tus grabaciones de fútbol a OTSI VIE. Importa, examina y prepáralas para el análisis.",
    },
    processing: {
      title: "Procesamiento por IA",
      subtitle: "Del vídeo en bruto a información útil: detección, seguimiento, identidad, eventos e indexación.",
    },
    analysis: { title: "Análisis", subtitle: "Espacio de trabajo de análisis de vídeo" },
    tactical: {
      title: "Inteligencia táctica",
      subtitle: "Más allá del vídeo: patrones tácticos, comportamiento del equipo y análisis de jugadores.",
    },
    reels: {
      title: "Reels",
      subtitle: "Spotlight Composer: reels cinematográficos de jugadores, respaldados por datos.",
    },
    studio: {
      title: "Estudio de clips",
      subtitle: "Crea, edita y monta reels en una línea de tiempo precisa a nivel de fotograma.",
    },
    reports: { title: "Informes", subtitle: "Informe de jugador respaldado por datos" },
    library: {
      title: "Biblioteca",
      subtitle: "Gestiona reels, informes, partidos, exportaciones y carpetas; busca y colabora.",
    },
    exports: {
      title: "Exportar",
      subtitle: "Renderiza, personaliza con tu marca y entrega los análisis de vídeo a tu equipo y clientes.",
    },
  },
  shell: {
    searchAndCommands: "Buscar y comandos (Ctrl+K)",
    searchHint: "Busca partidos, jugadores, reels y proyectos, o ejecuta un comando (Ctrl+K)",
    language: "Idioma",
  },
  body: {
    home: {
      heroEyebrow: "CONVIERTE EL VÍDEO DE FÚTBOL EN INFORMACIÓN",
      heroTitleA: "Fútbol profesional",
      heroTitleB: "Inteligencia de vídeo",
      heroSubtitle: "Sube partidos, analiza a cada jugador, crea reels y comparte",
      heroSubtitleB: "información — creado para analistas, ojeadores y agencias.",
      uploadVideo: "Subir vídeo",
      pasteLink: "Pegar enlace",
      featuredReel: "REEL DESTACADO",
      recentMatches: "Partidos recientes",
      sampleReels: "Reels de ejemplo",
      viewAll: "Ver todo",
      reviewInbox: "Bandeja de revisión",
      activeJobs: "Trabajos activos",
      howItWorks: "Cómo funciona",
      howItWorksSubtitle: "Del vídeo a información valiosa",
      howItWorksSubtitleB: "en cuestión de minutos.",
      capabilities: "Capacidades de la plataforma",
      trustStrip: "Creado para clubes, academias y ojeadores",
      trustedPartners: "SOCIOS DE CONFIANZA",
      noMatchesYet: "Aún no se ha analizado ningún partido",
      matchesListedHere: "Los partidos subidos aparecerán aquí",
      matchesLoadFailed: "No se pudieron cargar los partidos recientes",
      tapRetry: "Toca para reintentar",
      noReelsYet: "Aún no hay reels",
      reelsAppearHere: "Los reels generados aparecerán aquí",
      couldntLoadReels: "No se pudieron cargar los reels",
      reelsReadFailed: "No se pudieron leer los reels. Reintentar",
      featuredLoadFailed: "No se pudieron cargar los reels — toca para reintentar",
      noFeaturedReel: "No hay reel destacado",
      publishedReelsHere: "Los reels publicados aparecerán aquí",
      stepUploadDesc: "Sube un vídeo de partido o de entrenamiento",
      stepAnalyze: "Analiza con IA",
      stepAnalyzeDescA: "Nuestra IA detecta automáticamente a los jugadores,",
      stepAnalyzeDescB: "sigue el balón y extrae los eventos clave.",
      stepSelect: "Selecciona un jugador",
      stepSelectDescA: "Elige cualquier jugador y filtra por",
      stepSelectDescB: "acciones, fase o contexto del partido.",
      stepGenerate: "Genera el reel",
      stepGenerateDescA: "Crea un reel profesional de mejores momentos",
      stepGenerateDescB: "con filtros personalizados y tu marca.",
      stepExport: "Exporta y comparte",
      stepExportDescA: "Descarga un informe PDF detallado",
      stepExportDescB: "o comparte reels con tu equipo.",
    },
    analysis: {
      match: "Partido",
      visualOverlays: "Capas visuales",
      teamFilter: "Filtro de equipo",
      timeRange: "Intervalo de tiempo",
      chooseVideo: "Elige primero un vídeo de partido.",
      players: "Jugadores",
      clickBox: "Haz clic en un recuadro del vídeo o en un jugador de la lista.",
      createReel: "Crear reel de mejores momentos",
      openInReelBuilder: "Abrir en el Creador de reels ›",
      allEvents: "Todos los eventos",
      tracksPresence: "Seguimientos y presencia",
      lineups: "Alineaciones",
      noFinishedAnalysis: "Aún no hay un análisis terminado: no hay eventos.",
    },
    reels: {
      reelInfo: "Info del reel",
      reelTitle: "Título",
      reelDescription: "Descripción (opcional)",
      duration: "Duración",
      matches: "Partidos",
      music: "Música",
      aspectRatio: "Relación de aspecto",
      backToReels: "Volver a los reels",
      spotlightControls: "Controles de spotlight",
      playerTargeting: "Selección de jugador",
      branding: "Marca",
      output: "Salida",
      saveProject: "Guardar proyecto",
      previewRender: "Vista previa del render",
      videoClips: "Clips de vídeo",
      history: "Historial",
      addMoments: "Añade momentos para crear el reel",
      projectSaved: "Proyecto guardado.",
      unsavedChanges: "Cambios sin guardar",
      notSaved: "El proyecto no se guardó.",
      openReel: "Abrir un reel",
      allMatches: "Todos los partidos",
      reelsNotLoaded: "No se pudieron cargar los reels.",
      renderReel: "¿Renderizar este reel?",
      backToEditing: "Volver a editar",
      startRender: "Iniciar render",
    },
    studio: {
      chooseReel: "Elige un reel",
      noReelsYet: "Aún no hay reels.",
      makeInReelBuilder: "Crea uno en el Creador de reels",
      reelsLoadFailed: "No se pudieron cargar los reels.",
      backToReelBuilder: "Volver al Creador de reels",
      undo: "Deshacer",
      redo: "Rehacer",
      keyboardShortcuts: "Atajos de teclado",
      assets: "Recursos",
      searchBin: "Buscar clips, jugadores, etiquetas…",
      templates: "Plantillas",
      suggestedMoments: "Momentos sugeridos",
      clipDetails: "Detalles del clip",
      selectClip: "Selecciona un clip para ver lo que encontró el motor.",
      reelPreview: "Vista previa del reel",
      zoomIn: "Acercar",
      zoomOut: "Alejar",
    },
    reports: {
      choosePlayer: "Elige un jugador",
      searchPlayers: "Buscar por nombre…",
      noPlayerFound: "No se encontró ningún jugador.",
      playersNotLoaded: "No se pudieron cargar los jugadores.",
      identityEvidence: "Identidad y evidencia",
      keyMetrics: "Métricas clave",
      roleSummary: "Rol y resumen del jugador",
      notMeasured: "No medido",
      noTraits: "No hay rasgos registrados",
      editProfile: "Editar perfil ›",
      heatmap: "Mapa de calor",
      actionMap: "Mapa de acciones",
      eventTimeline: "Cronología de eventos (todas las acciones)",
      scoutingReport: "Informe de scouting",
      noScoutNotes: "No hay notas de scouting registradas.",
      viewFullReport: "Ver informe completo",
      playersListLink: "Lista de jugadores: completa sus perfiles ›",
    },
    library: {
      newProject: "Nuevo proyecto",
      searchLibrary: "Buscar proyectos, jugadores, etiquetas o contenido…",
      allAssets: "Todos los recursos",
      type: "Tipo",
      name: "Nombre",
      team: "Equipo",
      competition: "Competición",
      createdBy: "Creado por",
      loadingLibrary: "Cargando la biblioteca…",
      noSavedSearches: "Aún no hay búsquedas guardadas",
      trash: "Papelera",
      trashEmpty: "La papelera está vacía.",
      events: "Eventos",
      selectAsset: "Selecciona en la tabla un recurso con vídeo.",
      openInAnalysis: "Abrir en Análisis",
      download: "Descargar",
      rename: "Renombrar",
      share: "Compartir",
      sendToClient: "Enviar al cliente",
      smartBins: "Carpetas inteligentes",
      newSmartBin: "Nueva carpeta inteligente",
      createFolder: "Crear carpeta",
      clearFilters: "Limpiar filtros",
      saveSearch: "Guardar búsqueda actual",
      deletedItems: "Elementos eliminados",
    },
    exports: {
      projectSummary: "Resumen del proyecto",
      openReelToExport: "Abre un reel para exportar",
      exportSettings: "Ajustes de exportación",
      renderProgress: "Progreso del render",
      noRenderJobs: "No hay trabajos de render en cola",
      renderQueueNotLoaded: "No se pudo cargar la cola de render.",
      deliverToClient: "Entregar al cliente",
      outputPreset: "Preajuste de salida",
      fileFormat: "Formato de archivo",
      resolution: "Resolución",
      frameRate: "Frecuencia de fotogramas",
      quality: "Calidad",
      includeBranding: "Incluir marca",
      clientName: "Nombre del cliente",
      clientEmail: "Correo del cliente",
      message: "Mensaje (opcional)",
      noneYet: "Ninguna todavía.",
      shareableLink: "Enlace para compartir",
      noLinksYet: "Aún no hay enlaces.",
      exportPresets: "Preajustes de exportación",
      newPreset: "Nuevo preajuste",
      savePreset: "Guardar preajuste",
      downloadAll: "Descargar todo",
    },
    players: {
      subtitle: "Anota lo que sabes de cada jugador una sola vez. Los reels y los informes lo mostrarán. El vídeo nunca completa estos datos.",
      allPositions: "Todas las posiciones",
      confirmedRolesOnly: "Solo roles confirmados",
      searchPlaceholder: "Buscar por nombre o ID de jugador OTSI…",
      noMatch: "Ningún jugador coincide con la búsqueda.",
      noPlayersYet: "Aún no hay jugadores. Añade jugadores a la hoja de equipo de un partido o confirma quién es un jugador en Análisis.",
      position: "Posición",
      nationality: "Nacionalidad",
      preferredFoot: "Pie preferido",
      birthDate: "Fecha de nacimiento",
      teamNumber: "Equipo · N.º (de la hoja de equipo)",
      notOnTeamSheet: "Aún no está en una hoja de equipo",
      provisional: "Provisional",
      confirmed: "✓ Confirmado",
      confirm: "Confirmar",
      saving: "Guardando…",
      savedConfirmed: "Guardado y confirmado.",
      couldNotSave: "No se pudo guardar. Inténtalo de nuevo.",
      profileDetails: "Detalles del perfil para la intro",
      hideProfileDetails: "Ocultar los detalles del perfil para la intro",
      nothingEntered: "Aún no se ha introducido nada: la intro mostrará «No introducido».",
      someEntered: "Algunos detalles introducidos: se muestran en la Player Profile Intro como «Introducido por el usuario».",
      height: "Altura (cm)",
      weight: "Peso (kg)",
      club: "Club actual (solo si la hoja de equipo no nombra uno)",
      league: "Liga",
      intlCountry: "País internacional",
      intlCaps: "Partidos internacionales",
      intlGoals: "Goles internacionales",
      summary: "Resumen del jugador (máximo 600 caracteres)",
      strengths: "Fortalezas del jugador (hasta 6, máximo 60 caracteres cada una)",
      addStrength: "+ Añadir fortaleza",
      photo: "Foto (se muestra en la intro)",
      noPhotoYet: "Aún no hay foto.",
      uploadPhoto: "Subir foto",
      uploading: "Subiendo…",
      photoSaved: "Foto guardada.",
      saveDetails: "Guardar detalles del perfil",
      readOnly: "Creado por otra organización: solo lectura",
      openReport: "Abrir informe ›",
      noOtsiId: "Provisional: aún no hay ID de jugador OTSI",
      notRecorded: "No registrado",
      heightError: "La altura es de 100–250 cm.",
      weightError: "El peso es de 30–200 kg.",
    },
  },
};

export const de: DeepPartial<Dictionary> = {
  nav: {
    home: "Start",
    upload: "Hochladen",
    processing: "Verarbeitung",
    analysis: "Analyse",
    tactical: "Taktik",
    reels: "Reel-Builder",
    studio: "Clip-Studio",
    reports: "Spielerbericht",
    library: "Bibliothek",
    export: "Export",
  },
  common: {
    search: "Suchen",
    signOut: "Abmelden",
    save: "Speichern",
    cancel: "Abbrechen",
    close: "Schließen",
    back: "Zurück",
    continue: "Weiter",
    loading: "Wird geladen…",
    retry: "Erneut versuchen",
    language: "Sprache",
  },
  pages: {
    home: { title: "Start", subtitle: "Verwandeln Sie Fußballvideos in Erkenntnisse" },
    upload: {
      title: "Hochladen",
      subtitle: "Bringen Sie Ihre Fußballaufnahmen in OTSI VIE. Einlesen, prüfen und für die Analyse vorbereiten.",
    },
    processing: {
      title: "KI-Verarbeitung",
      subtitle: "Vom Rohvideo zu verwertbaren Erkenntnissen: Erkennung, Tracking, Identität, Ereignisse und Indexierung.",
    },
    analysis: { title: "Analyse", subtitle: "Arbeitsbereich für Videoanalyse" },
    tactical: {
      title: "Taktische Intelligenz",
      subtitle: "Über das Video hinaus: taktische Muster, Teamverhalten und Spielereinblicke.",
    },
    reels: {
      title: "Reels",
      subtitle: "Spotlight Composer: filmische, datengestützte Spieler-Reels.",
    },
    studio: {
      title: "Clip-Studio",
      subtitle: "Erstellen, bearbeiten und montieren Sie Reels auf einer framegenauen Timeline.",
    },
    reports: { title: "Berichte", subtitle: "Datengestützter Spielerbericht" },
    library: {
      title: "Bibliothek",
      subtitle: "Verwalten Sie Reels, Berichte, Spiele, Exporte und Ordner; suchen und zusammenarbeiten.",
    },
    exports: {
      title: "Export",
      subtitle: "Rendern, branden und liefern Sie Video-Erkenntnisse an Ihr Team und Ihre Kunden.",
    },
  },
  shell: {
    searchAndCommands: "Suche und Befehle (Strg+K)",
    searchHint: "Suchen Sie Spiele, Spieler, Reels und Projekte oder führen Sie einen Befehl aus (Strg+K)",
    language: "Sprache",
  },
  body: {
    home: {
      heroEyebrow: "VERWANDELN SIE FUSSBALLVIDEOS IN ERKENNTNISSE",
      heroTitleA: "Professioneller Fußball",
      heroTitleB: "Video-Intelligenz",
      heroSubtitle: "Laden Sie Spiele hoch, analysieren Sie jeden Spieler, erstellen Sie Reels und teilen Sie",
      heroSubtitleB: "Erkenntnisse — für Analysten, Scouts und Agenturen.",
      uploadVideo: "Video hochladen",
      pasteLink: "Link einfügen",
      featuredReel: "EMPFOHLENES REEL",
      recentMatches: "Letzte Spiele",
      sampleReels: "Beispiel-Reels",
      viewAll: "Alle ansehen",
      reviewInbox: "Prüfposteingang",
      activeJobs: "Aktive Aufträge",
      howItWorks: "So funktioniert es",
      howItWorksSubtitle: "Vom Video zu wertvollen Erkenntnissen",
      howItWorksSubtitleB: "in wenigen Minuten.",
      capabilities: "Funktionen der Plattform",
      trustStrip: "Gebaut für Vereine, Akademien und Scouts",
      trustedPartners: "VERTRAUENSWÜRDIGE PARTNER",
      noMatchesYet: "Noch keine Spiele analysiert",
      matchesListedHere: "Hochgeladene Spiele erscheinen hier",
      matchesLoadFailed: "Letzte Spiele konnten nicht geladen werden",
      tapRetry: "Zum Wiederholen tippen",
      noReelsYet: "Noch keine Reels",
      reelsAppearHere: "Erstellte Reels erscheinen hier",
      couldntLoadReels: "Reels konnten nicht geladen werden",
      reelsReadFailed: "Reels konnten nicht gelesen werden. Erneut versuchen",
      featuredLoadFailed: "Reels konnten nicht geladen werden — zum Wiederholen tippen",
      noFeaturedReel: "Kein empfohlenes Reel",
      publishedReelsHere: "Veröffentlichte Reels erscheinen hier",
      stepUploadDesc: "Laden Sie ein Spiel- oder Trainingsvideo hoch",
      stepAnalyze: "Mit KI analysieren",
      stepAnalyzeDescA: "Unsere KI erkennt Spieler automatisch,",
      stepAnalyzeDescB: "verfolgt den Ball und extrahiert wichtige Ereignisse.",
      stepSelect: "Wählen Sie einen Spieler",
      stepSelectDescA: "Wählen Sie einen Spieler und filtern Sie nach",
      stepSelectDescB: "Aktionen, Phase oder Spielkontext.",
      stepGenerate: "Reel erstellen",
      stepGenerateDescA: "Erstellen Sie ein professionelles Highlight-Reel",
      stepGenerateDescB: "mit eigenen Filtern und Branding.",
      stepExport: "Exportieren und teilen",
      stepExportDescA: "Laden Sie einen ausführlichen PDF-Bericht herunter",
      stepExportDescB: "oder teilen Sie Reels mit Ihrem Team.",
    },
    analysis: {
      match: "Spiel",
      visualOverlays: "Visuelle Overlays",
      teamFilter: "Teamfilter",
      timeRange: "Zeitraum",
      chooseVideo: "Wählen Sie zuerst ein Spielvideo.",
      players: "Spieler",
      clickBox: "Klicken Sie auf ein Feld im Video oder auf einen Spieler in der Liste.",
      createReel: "Highlight-Reel erstellen",
      openInReelBuilder: "Im Reel-Builder öffnen ›",
      allEvents: "Alle Ereignisse",
      tracksPresence: "Tracks und Präsenz",
      lineups: "Aufstellungen",
      noFinishedAnalysis: "Noch keine fertige Analyse: keine Ereignisse.",
    },
    reels: {
      reelInfo: "Reel-Info",
      reelTitle: "Titel",
      reelDescription: "Beschreibung (optional)",
      duration: "Dauer",
      matches: "Spiele",
      music: "Musik",
      aspectRatio: "Seitenverhältnis",
      backToReels: "Zurück zu den Reels",
      spotlightControls: "Spotlight-Steuerung",
      playerTargeting: "Spieler-Targeting",
      branding: "Markenauftritt",
      output: "Ausgabe",
      saveProject: "Projekt speichern",
      previewRender: "Render-Vorschau",
      videoClips: "Videoclips",
      history: "Verlauf",
      addMoments: "Fügen Sie Momente hinzu, um das Reel zu erstellen",
      projectSaved: "Projekt gespeichert.",
      unsavedChanges: "Ungespeicherte Änderungen",
      notSaved: "Das Projekt wurde nicht gespeichert.",
      openReel: "Reel öffnen",
      allMatches: "Alle Spiele",
      reelsNotLoaded: "Reels konnten nicht geladen werden.",
      renderReel: "Dieses Reel rendern?",
      backToEditing: "Zurück zur Bearbeitung",
      startRender: "Rendering starten",
    },
    studio: {
      chooseReel: "Wählen Sie ein Reel",
      noReelsYet: "Noch keine Reels.",
      makeInReelBuilder: "Erstellen Sie eines im Reel-Builder",
      reelsLoadFailed: "Die Reels konnten nicht geladen werden.",
      backToReelBuilder: "Zurück zum Reel-Builder",
      undo: "Rückgängig",
      redo: "Wiederholen",
      keyboardShortcuts: "Tastenkürzel",
      assets: "Assets",
      searchBin: "Clips, Spieler, Tags suchen…",
      templates: "Vorlagen",
      suggestedMoments: "Vorgeschlagene Momente",
      clipDetails: "Clip-Details",
      selectClip: "Wählen Sie einen Clip, um zu sehen, was die Engine gefunden hat.",
      reelPreview: "Reel-Vorschau",
      zoomIn: "Vergrößern",
      zoomOut: "Verkleinern",
    },
    reports: {
      choosePlayer: "Wählen Sie einen Spieler",
      searchPlayers: "Nach Name suchen…",
      noPlayerFound: "Kein Spieler gefunden.",
      playersNotLoaded: "Spieler konnten nicht geladen werden.",
      identityEvidence: "Identität und Belege",
      keyMetrics: "Kennzahlen",
      roleSummary: "Spielerrolle und Zusammenfassung",
      notMeasured: "Nicht gemessen",
      noTraits: "Keine Merkmale erfasst",
      editProfile: "Profil bearbeiten ›",
      heatmap: "Wärmekarte",
      actionMap: "Aktionskarte",
      eventTimeline: "Ereignis-Zeitleiste (alle Aktionen)",
      scoutingReport: "Scouting-Bericht",
      noScoutNotes: "Keine Scout-Notizen erfasst.",
      viewFullReport: "Vollständigen Bericht ansehen",
      playersListLink: "Spielerliste: Profile eintragen ›",
    },
    library: {
      newProject: "Neues Projekt",
      searchLibrary: "Projekte, Spieler, Tags oder Inhalte suchen…",
      allAssets: "Alle Assets",
      type: "Typ",
      name: "Name",
      team: "Team",
      competition: "Wettbewerb",
      createdBy: "Erstellt von",
      loadingLibrary: "Bibliothek wird geladen…",
      noSavedSearches: "Noch keine gespeicherten Suchen",
      trash: "Papierkorb",
      trashEmpty: "Der Papierkorb ist leer.",
      events: "Ereignisse",
      selectAsset: "Wählen Sie in der Tabelle ein Asset mit Video.",
      openInAnalysis: "In der Analyse öffnen",
      download: "Herunterladen",
      rename: "Umbenennen",
      share: "Teilen",
      sendToClient: "An Kunden senden",
      smartBins: "Intelligente Ordner",
      newSmartBin: "Neuer intelligenter Ordner",
      createFolder: "Ordner erstellen",
      clearFilters: "Filter löschen",
      saveSearch: "Aktuelle Suche speichern",
      deletedItems: "Gelöschte Elemente",
    },
    exports: {
      projectSummary: "Projektübersicht",
      openReelToExport: "Öffnen Sie ein Reel zum Exportieren",
      exportSettings: "Exporteinstellungen",
      renderProgress: "Render-Fortschritt",
      noRenderJobs: "Keine Renderaufträge in der Warteschlange",
      renderQueueNotLoaded: "Die Renderwarteschlange konnte nicht geladen werden.",
      deliverToClient: "An Kunden liefern",
      outputPreset: "Ausgabe-Preset",
      fileFormat: "Dateiformat",
      resolution: "Auflösung",
      frameRate: "Bildrate",
      quality: "Qualität",
      includeBranding: "Branding einbeziehen",
      clientName: "Kundenname",
      clientEmail: "Kunden-E-Mail",
      message: "Nachricht (optional)",
      noneYet: "Noch keine.",
      shareableLink: "Freigabelink",
      noLinksYet: "Noch keine Links.",
      exportPresets: "Export-Presets",
      newPreset: "Neues Preset",
      savePreset: "Preset speichern",
      downloadAll: "Alle herunterladen",
    },
    players: {
      subtitle: "Tragen Sie einmal ein, was Sie über jeden Spieler wissen. Reels und Berichte zeigen es. Das Video füllt diese Daten nie aus.",
      allPositions: "Alle Positionen",
      confirmedRolesOnly: "Nur bestätigte Rollen",
      searchPlaceholder: "Nach Name oder OTSI-Spieler-ID suchen…",
      noMatch: "Kein Spieler passt zur Suche.",
      noPlayersYet: "Noch keine Spieler. Fügen Sie Spieler zur Mannschaftsaufstellung eines Spiels hinzu oder bestätigen Sie in der Analyse, wer ein Spieler ist.",
      position: "Position",
      nationality: "Nationalität",
      preferredFoot: "Starker Fuß",
      birthDate: "Geburtsdatum",
      teamNumber: "Team · Nr. (aus der Aufstellung)",
      notOnTeamSheet: "Noch in keiner Aufstellung",
      provisional: "Vorläufig",
      confirmed: "✓ Bestätigt",
      confirm: "Bestätigen",
      saving: "Wird gespeichert…",
      savedConfirmed: "Gespeichert und bestätigt.",
      couldNotSave: "Konnte nicht gespeichert werden. Bitte erneut versuchen.",
      profileDetails: "Profildetails für das Intro",
      hideProfileDetails: "Profildetails für das Intro ausblenden",
      nothingEntered: "Noch nichts eingetragen — das Intro zeigt „Nicht eingetragen“.",
      someEntered: "Einige Details eingetragen — im Player Profile Intro als „Vom Nutzer eingetragen“ angezeigt.",
      height: "Größe (cm)",
      weight: "Gewicht (kg)",
      club: "Aktueller Verein (nur wenn die Aufstellung keinen nennt)",
      league: "Liga",
      intlCountry: "Nationalmannschaftsland",
      intlCaps: "Länderspiele",
      intlGoals: "Länderspieltore",
      summary: "Spielerzusammenfassung (max. 600 Zeichen)",
      strengths: "Stärken des Spielers (bis zu 6, je max. 60 Zeichen)",
      addStrength: "+ Stärke hinzufügen",
      photo: "Foto (wird im Intro gezeigt)",
      noPhotoYet: "Noch kein Foto.",
      uploadPhoto: "Foto hochladen",
      uploading: "Wird hochgeladen…",
      photoSaved: "Foto gespeichert.",
      saveDetails: "Profildetails speichern",
      readOnly: "Von einer anderen Organisation erstellt: nur lesen",
      openReport: "Bericht öffnen ›",
      noOtsiId: "Vorläufig: noch keine OTSI-Spieler-ID",
      notRecorded: "Nicht erfasst",
      heightError: "Die Größe liegt bei 100–250 cm.",
      weightError: "Das Gewicht liegt bei 30–200 kg.",
    },
  },
};

export const fr: DeepPartial<Dictionary> = {
  nav: {
    home: "Accueil",
    upload: "Importer",
    processing: "Traitement",
    analysis: "Analyse",
    tactical: "Tactique",
    reels: "Créateur de reels",
    studio: "Studio de clips",
    reports: "Rapport joueur",
    library: "Bibliothèque",
    export: "Exporter",
  },
  common: {
    search: "Rechercher",
    signOut: "Se déconnecter",
    save: "Enregistrer",
    cancel: "Annuler",
    close: "Fermer",
    back: "Retour",
    continue: "Continuer",
    loading: "Chargement…",
    retry: "Réessayer",
    language: "Langue",
  },
  pages: {
    home: { title: "Accueil", subtitle: "Transformez la vidéo de football en analyses" },
    upload: {
      title: "Importer",
      subtitle: "Importez vos vidéos de football dans OTSI VIE. Ingestion, vérification et préparation pour l'analyse.",
    },
    processing: {
      title: "Traitement par IA",
      subtitle: "De la vidéo brute à des analyses utiles : détection, suivi, identité, événements et indexation.",
    },
    analysis: { title: "Analyse", subtitle: "Espace de travail d'analyse vidéo" },
    tactical: {
      title: "Intelligence tactique",
      subtitle: "Au-delà de la vidéo : schémas tactiques, comportement de l'équipe et analyses des joueurs.",
    },
    reels: {
      title: "Reels",
      subtitle: "Spotlight Composer : des reels cinématographiques de joueurs, étayés par les données.",
    },
    studio: {
      title: "Studio de clips",
      subtitle: "Créez, modifiez et assemblez des reels sur une timeline précise à l'image.",
    },
    reports: { title: "Rapports", subtitle: "Rapport joueur étayé par les données" },
    library: {
      title: "Bibliothèque",
      subtitle: "Gérez les reels, rapports, matchs, exports et dossiers ; recherchez et collaborez.",
    },
    exports: {
      title: "Exporter",
      subtitle: "Rendez, habillez aux couleurs de votre marque et livrez les analyses vidéo à votre équipe et vos clients.",
    },
  },
  shell: {
    searchAndCommands: "Recherche et commandes (Ctrl+K)",
    searchHint: "Recherchez des matchs, joueurs, reels et projets, ou exécutez une commande (Ctrl+K)",
    language: "Langue",
  },
  body: {
    home: {
      heroEyebrow: "TRANSFORMEZ LA VIDÉO DE FOOTBALL EN ANALYSES",
      heroTitleA: "Football professionnel",
      heroTitleB: "Intelligence vidéo",
      heroSubtitle: "Importez des matchs, analysez chaque joueur, créez des reels et partagez",
      heroSubtitleB: "vos analyses — conçu pour les analystes, les recruteurs et les agences.",
      uploadVideo: "Importer une vidéo",
      pasteLink: "Coller un lien",
      featuredReel: "REEL À LA UNE",
      recentMatches: "Matchs récents",
      sampleReels: "Exemples de reels",
      viewAll: "Tout voir",
      reviewInbox: "Boîte de révision",
      activeJobs: "Tâches en cours",
      howItWorks: "Comment ça marche",
      howItWorksSubtitle: "De la vidéo à des analyses précieuses",
      howItWorksSubtitleB: "en quelques minutes.",
      capabilities: "Fonctionnalités de la plateforme",
      trustStrip: "Conçu pour les clubs, les académies et les recruteurs",
      trustedPartners: "PARTENAIRES DE CONFIANCE",
      noMatchesYet: "Aucun match analysé pour l'instant",
      matchesListedHere: "Les matchs importés apparaîtront ici",
      matchesLoadFailed: "Impossible de charger les matchs récents",
      tapRetry: "Touchez pour réessayer",
      noReelsYet: "Aucun reel pour l'instant",
      reelsAppearHere: "Les reels générés apparaîtront ici",
      couldntLoadReels: "Impossible de charger les reels",
      reelsReadFailed: "Impossible de lire les reels. Réessayer",
      featuredLoadFailed: "Impossible de charger les reels — touchez pour réessayer",
      noFeaturedReel: "Aucun reel à la une",
      publishedReelsHere: "Les reels publiés apparaîtront ici",
      stepUploadDesc: "Importez une vidéo de match ou d'entraînement",
      stepAnalyze: "Analyse par IA",
      stepAnalyzeDescA: "Notre IA détecte automatiquement les joueurs,",
      stepAnalyzeDescB: "suit le ballon et extrait les événements clés.",
      stepSelect: "Sélectionnez un joueur",
      stepSelectDescA: "Choisissez un joueur et filtrez par",
      stepSelectDescB: "actions, phase ou contexte de jeu.",
      stepGenerate: "Générez le reel",
      stepGenerateDescA: "Créez un reel professionnel des meilleurs moments",
      stepGenerateDescB: "avec des filtres personnalisés et votre marque.",
      stepExport: "Exportez et partagez",
      stepExportDescA: "Téléchargez un rapport PDF détaillé",
      stepExportDescB: "ou partagez des reels avec votre équipe.",
    },
    analysis: {
      match: "Match",
      visualOverlays: "Calques visuels",
      teamFilter: "Filtre d'équipe",
      timeRange: "Plage de temps",
      chooseVideo: "Choisissez d'abord une vidéo de match.",
      players: "Joueurs",
      clickBox: "Cliquez sur un cadre dans la vidéo ou sur un joueur de la liste.",
      createReel: "Créer un reel des meilleurs moments",
      openInReelBuilder: "Ouvrir dans le Créateur de reels ›",
      allEvents: "Tous les événements",
      tracksPresence: "Suivis et présence",
      lineups: "Compositions",
      noFinishedAnalysis: "Aucune analyse terminée pour l'instant : aucun événement.",
    },
    reels: {
      reelInfo: "Infos du reel",
      reelTitle: "Titre",
      reelDescription: "Description (facultatif)",
      duration: "Durée",
      matches: "Matchs",
      music: "Musique",
      aspectRatio: "Format d'image",
      backToReels: "Retour aux reels",
      spotlightControls: "Réglages du spotlight",
      playerTargeting: "Ciblage du joueur",
      branding: "Marque",
      output: "Sortie",
      saveProject: "Enregistrer le projet",
      previewRender: "Aperçu du rendu",
      videoClips: "Clips vidéo",
      history: "Historique",
      addMoments: "Ajoutez des moments pour créer le reel",
      projectSaved: "Projet enregistré.",
      unsavedChanges: "Modifications non enregistrées",
      notSaved: "Le projet n'a pas été enregistré.",
      openReel: "Ouvrir un reel",
      allMatches: "Tous les matchs",
      reelsNotLoaded: "Impossible de charger les reels.",
      renderReel: "Rendre ce reel ?",
      backToEditing: "Retour à l'édition",
      startRender: "Lancer le rendu",
    },
    studio: {
      chooseReel: "Choisissez un reel",
      noReelsYet: "Aucun reel pour l'instant.",
      makeInReelBuilder: "Créez-en un dans le Créateur de reels",
      reelsLoadFailed: "Impossible de charger les reels.",
      backToReelBuilder: "Retour au Créateur de reels",
      undo: "Annuler",
      redo: "Rétablir",
      keyboardShortcuts: "Raccourcis clavier",
      assets: "Ressources",
      searchBin: "Rechercher des clips, joueurs, tags…",
      templates: "Modèles",
      suggestedMoments: "Moments suggérés",
      clipDetails: "Détails du clip",
      selectClip: "Sélectionnez un clip pour voir ce que le moteur y a trouvé.",
      reelPreview: "Aperçu du reel",
      zoomIn: "Zoom avant",
      zoomOut: "Zoom arrière",
    },
    reports: {
      choosePlayer: "Choisissez un joueur",
      searchPlayers: "Rechercher par nom…",
      noPlayerFound: "Aucun joueur trouvé.",
      playersNotLoaded: "Impossible de charger les joueurs.",
      identityEvidence: "Identité et preuves",
      keyMetrics: "Statistiques clés",
      roleSummary: "Rôle et résumé du joueur",
      notMeasured: "Non mesuré",
      noTraits: "Aucun trait enregistré",
      editProfile: "Modifier le profil ›",
      heatmap: "Carte de chaleur",
      actionMap: "Carte des actions",
      eventTimeline: "Chronologie des événements (toutes les actions)",
      scoutingReport: "Rapport de scouting",
      noScoutNotes: "Aucune note de scouting enregistrée.",
      viewFullReport: "Voir le rapport complet",
      playersListLink: "Liste des joueurs : complétez leurs profils ›",
    },
    library: {
      newProject: "Nouveau projet",
      searchLibrary: "Rechercher des projets, joueurs, tags ou contenus…",
      allAssets: "Toutes les ressources",
      type: "Catégorie",
      name: "Nom",
      team: "Équipe",
      competition: "Compétition",
      createdBy: "Créé par",
      loadingLibrary: "Chargement de la bibliothèque…",
      noSavedSearches: "Aucune recherche enregistrée pour l'instant",
      trash: "Corbeille",
      trashEmpty: "La corbeille est vide.",
      events: "Événements",
      selectAsset: "Sélectionnez dans le tableau une ressource avec vidéo.",
      openInAnalysis: "Ouvrir dans Analyse",
      download: "Télécharger",
      rename: "Renommer",
      share: "Partager",
      sendToClient: "Envoyer au client",
      smartBins: "Dossiers intelligents",
      newSmartBin: "Nouveau dossier intelligent",
      createFolder: "Créer un dossier",
      clearFilters: "Effacer les filtres",
      saveSearch: "Enregistrer la recherche actuelle",
      deletedItems: "Éléments supprimés",
    },
    exports: {
      projectSummary: "Résumé du projet",
      openReelToExport: "Ouvrez un reel à exporter",
      exportSettings: "Paramètres d'export",
      renderProgress: "Progression du rendu",
      noRenderJobs: "Aucun rendu en file d'attente",
      renderQueueNotLoaded: "Impossible de charger la file de rendu.",
      deliverToClient: "Livrer au client",
      outputPreset: "Préréglage de sortie",
      fileFormat: "Format de fichier",
      resolution: "Résolution",
      frameRate: "Fréquence d'images",
      quality: "Qualité",
      includeBranding: "Inclure la marque",
      clientName: "Nom du client",
      clientEmail: "E-mail du client",
      message: "Message (facultatif)",
      noneYet: "Aucune pour l'instant.",
      shareableLink: "Lien partageable",
      noLinksYet: "Aucun lien pour l'instant.",
      exportPresets: "Préréglages d'export",
      newPreset: "Nouveau préréglage",
      savePreset: "Enregistrer le préréglage",
      downloadAll: "Tout télécharger",
    },
    players: {
      subtitle: "Saisissez une fois ce que vous savez de chaque joueur. Les reels et les rapports l'afficheront. La vidéo ne remplit jamais ces données.",
      allPositions: "Tous les postes",
      confirmedRolesOnly: "Rôles confirmés uniquement",
      searchPlaceholder: "Rechercher par nom ou ID joueur OTSI…",
      noMatch: "Aucun joueur ne correspond à la recherche.",
      noPlayersYet: "Aucun joueur pour l'instant. Ajoutez des joueurs à la feuille d'équipe d'un match ou confirmez l'identité d'un joueur dans Analyse.",
      position: "Poste",
      nationality: "Nationalité",
      preferredFoot: "Pied préféré",
      birthDate: "Date de naissance",
      teamNumber: "Équipe · N° (de la feuille d'équipe)",
      notOnTeamSheet: "Pas encore sur une feuille d'équipe",
      provisional: "Provisoire",
      confirmed: "✓ Confirmé",
      confirm: "Confirmer",
      saving: "Enregistrement…",
      savedConfirmed: "Enregistré et confirmé.",
      couldNotSave: "Impossible d'enregistrer. Réessayez.",
      profileDetails: "Détails du profil pour l'intro",
      hideProfileDetails: "Masquer les détails du profil pour l'intro",
      nothingEntered: "Rien de saisi pour l'instant — l'intro affichera « Non renseigné ».",
      someEntered: "Certains détails sont renseignés — affichés dans la Player Profile Intro comme « Renseigné par l'utilisateur ».",
      height: "Taille (cm)",
      weight: "Poids (kg)",
      club: "Club actuel (seulement si la feuille d'équipe n'en nomme pas)",
      league: "Championnat",
      intlCountry: "Pays (sélection)",
      intlCaps: "Sélections",
      intlGoals: "Buts en sélection",
      summary: "Résumé du joueur (600 caractères maximum)",
      strengths: "Points forts du joueur (jusqu'à 6, 60 caractères maximum chacun)",
      addStrength: "+ Ajouter un point fort",
      photo: "Photo (affichée dans l'intro)",
      noPhotoYet: "Aucune photo pour l'instant.",
      uploadPhoto: "Importer une photo",
      uploading: "Import…",
      photoSaved: "Photo enregistrée.",
      saveDetails: "Enregistrer les détails du profil",
      readOnly: "Créé par une autre organisation : lecture seule",
      openReport: "Ouvrir le rapport ›",
      noOtsiId: "Provisoire : pas encore d'ID joueur OTSI",
      notRecorded: "Non renseigné",
      heightError: "La taille est de 100 à 250 cm.",
      weightError: "Le poids est de 30 à 200 kg.",
    },
  },
};

const PARTIALS: Record<Exclude<Locale, "en">, DeepPartial<Dictionary>> = { ru, es, de, fr };

/**
 * Merge a partial dictionary over a complete one; a missing leaf keeps the base (English) string.
 * Written section by section (not a generic recursion) so the type checker sees every key:
 * a translation that omits a key leaves the English string in place, never a blank.
 */
export function mergeDictionary(base: Dictionary, override: DeepPartial<Dictionary>): Dictionary {
  return {
    nav: { ...base.nav, ...override.nav },
    common: { ...base.common, ...override.common },
    pages: {
      home: { ...base.pages.home, ...override.pages?.home },
      upload: { ...base.pages.upload, ...override.pages?.upload },
      processing: { ...base.pages.processing, ...override.pages?.processing },
      analysis: { ...base.pages.analysis, ...override.pages?.analysis },
      tactical: { ...base.pages.tactical, ...override.pages?.tactical },
      reels: { ...base.pages.reels, ...override.pages?.reels },
      studio: { ...base.pages.studio, ...override.pages?.studio },
      reports: { ...base.pages.reports, ...override.pages?.reports },
      library: { ...base.pages.library, ...override.pages?.library },
      exports: { ...base.pages.exports, ...override.pages?.exports },
    },
    shell: { ...base.shell, ...override.shell },
    body: {
      home: { ...base.body.home, ...override.body?.home },
      analysis: { ...base.body.analysis, ...override.body?.analysis },
      reels: { ...base.body.reels, ...override.body?.reels },
      studio: { ...base.body.studio, ...override.body?.studio },
      reports: { ...base.body.reports, ...override.body?.reports },
      library: { ...base.body.library, ...override.body?.library },
      exports: { ...base.body.exports, ...override.body?.exports },
      players: { ...base.body.players, ...override.body?.players },
    },
  };
}

/** The complete dictionary for a locale: its translations over English, so a missing key is English, never blank. */
export function getDictionary(locale: Locale): Dictionary {
  return locale === "en" ? en : mergeDictionary(en, PARTIALS[locale]);
}
