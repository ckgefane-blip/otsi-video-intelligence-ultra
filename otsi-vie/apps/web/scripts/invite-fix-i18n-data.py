"""New i18n keys for the Invite signup fix (2026-11-14).

- body.invite.setupCodeLabel / setupCodePlaceholder: the "I have an invite code" field on the
  setup page, so a friend can type the code into their own app instead of opening a
  localhost-only invite link.
- body.wallet.blCantLoadOffline: the plain "can't load this while offline" line the Admin
  billing console and Plans & billing show when a section has no last-known data to show.
"""
INVITE_FIX_KEYS = {
    "invite": {
        "setupCodeLabel": {
            "en": "Invite code (optional)",
            "ru": "Код приглашения (необязательно)",
            "es": "Código de invitación (opcional)",
            "de": "Einladungscode (optional)",
            "fr": "Code d’invitation (facultatif)",
            "pt": "Código de convite (opcional)",
        },
        "setupCodePlaceholder": {
            "en": "Paste the code from your invite link",
            "ru": "Вставьте код из ссылки-приглашения",
            "es": "Pega el código de tu enlace de invitación",
            "de": "Code aus deinem Einladungslink einfügen",
            "fr": "Collez le code de votre lien d’invitation",
            "pt": "Cole o código do seu link de convite",
        },
    },
    "wallet": {
        "blCantLoadOffline": {
            "en": "Can’t load this while offline.",
            "ru": "Нельзя загрузить без подключения.",
            "es": "No se puede cargar sin conexión.",
            "de": "Kann offline nicht geladen werden.",
            "fr": "Impossible de charger hors ligne.",
            "pt": "Não é possível carregar offline.",
        },
    },
}
