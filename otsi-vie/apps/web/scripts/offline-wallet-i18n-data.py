"""Data for the offline-wallet i18n keys (wallet group).

wlOfflineNote: shown above the last-known ledger / pack requests when the
page is offline and cached data is shown.
wlLedgerOffline: shown in the ledger section when offline and nothing was
ever cached (instead of the wrong "No ledger entries yet").
wlRequestsOffline: the same for pack requests.
"""
OFFLINE_WALLET_KEYS = {
    "wlOfflineNote": {
        "en": "You're offline — showing the last data this app saw.",
        "ru": "Вы офлайн — показаны последние данные, которые видело приложение.",
        "es": "Sin conexión — se muestran los últimos datos que vio la app.",
        "de": "Sie sind offline — die zuletzt gesehenen Daten werden angezeigt.",
        "fr": "Vous êtes hors ligne — affichage des dernières données vues par l'app.",
        "pt": "Você está offline — mostrando os últimos dados vistos pelo app.",
    },
    "wlLedgerOffline": {
        "en": "Can't load the ledger while offline.",
        "ru": "Нельзя загрузить журнал без подключения.",
        "es": "No se puede cargar el libro sin conexión.",
        "de": "Das Hauptbuch kann offline nicht geladen werden.",
        "fr": "Impossible de charger le livre hors ligne.",
        "pt": "Não é possível carregar o livro offline.",
    },
    "wlRequestsOffline": {
        "en": "Can't load pack requests while offline.",
        "ru": "Нельзя загрузить запросы пакетов без подключения.",
        "es": "No se pueden cargar las solicitudes de paquetes sin conexión.",
        "de": "Paketanfragen können offline nicht geladen werden.",
        "fr": "Impossible de charger les demandes de packs hors ligne.",
        "pt": "Não é possível carregar as solicitações de pacotes offline.",
    },
}
