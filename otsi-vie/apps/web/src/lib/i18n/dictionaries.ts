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
 * common actions, and the app-shell strings (search, language). Player,
 * club and league names, OTSI PINs and other proper nouns are never
 * translated and never appear here. Page bodies adopt these strings
 * incrementally (ADR-139 §5); the navigation and the shell are wired now.
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
  };
}

/** The complete dictionary for a locale: its translations over English, so a missing key is English, never blank. */
export function getDictionary(locale: Locale): Dictionary {
  return locale === "en" ? en : mergeDictionary(en, PARTIALS[locale]);
}
