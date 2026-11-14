"""Invite-card i18n data (2026-11-14): the gift button opens a card, not a page.

Three new keys in the body.invite group, in every locale with real translations:
- copyCode: the card's primary button (the code is what a friend types in).
- codeCopied: shown next to the Copy code button once copied (owner rule).
- linkLocalNote: the localhost link only opens on this computer, so it is shown
  small in the card with this note — the code is the main thing.
"""

INVITE_CARD_KEYS = {
    "copyCode": {
        "en": "Copy code",
        "ru": "Скопировать код",
        "es": "Copiar código",
        "de": "Code kopieren",
        "fr": "Copier le code",
        "pt": "Copiar código",
    },
    "codeCopied": {
        "en": "Code copied",
        "ru": "Код скопирован",
        "es": "Código copiado",
        "de": "Code kopiert",
        "fr": "Code copié",
        "pt": "Código copiado",
    },
    "linkLocalNote": {
        "en": "Only opens on this computer — your friend types the code into their own app.",
        "ru": "Открывается только на этом компьютере — ваш друг вводит код в своём приложении.",
        "es": "Solo se abre en este ordenador: tu amigo escribe el código en su propia aplicación.",
        "de": "Öffnet sich nur auf diesem Computer — dein Freund tippt den Code in seiner eigenen App ein.",
        "fr": "Ne s'ouvre que sur cet ordinateur — ton ami saisit le code dans sa propre application.",
        "pt": "Só abre neste computador — o teu amigo escreve o código na sua própria aplicação.",
    },
}

# Insertion order inside the invite group (after setupCodePlaceholder, the last key).
INVITE_CARD_ORDER = ["copyCode", "codeCopied", "linkLocalNote"]
