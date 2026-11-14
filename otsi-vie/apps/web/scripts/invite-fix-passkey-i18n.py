"""Update webauthn.passkeyUnavailable in dictionaries.ts (all 6 locales).

When Windows Hello is not offered, the message now tells the user to turn on
"Save passkeys to this Windows device" in their browser settings. The quoted
setting name stays in English in every locale: it is the literal label to look for.
Run from apps/web: python3 scripts/invite-fix-passkey-i18n.py
"""
OLD = {
    "en": 'passkeyUnavailable: "This browser does not support passkeys here. Use your password.",',
    "ru": 'passkeyUnavailable: "Этот браузер не поддерживает ключи доступа здесь. Используйте пароль.",',
    "es": 'passkeyUnavailable: "Este navegador no admite claves de acceso aquí. Usa tu contraseña.",',
    "de": 'passkeyUnavailable: "Dieser Browser unterstützt hier keine Passkeys. Verwende dein Passwort.",',
    "fr": 'passkeyUnavailable: "Ce navigateur ne prend pas en charge les clés d’accès ici. Utilisez votre mot de passe.",',
    "pt": '"passkeyUnavailable": "Este navegador não suporta chaves de acesso aqui. Use sua senha.",',
}
NEW = {
    "en": 'passkeyUnavailable: "This browser does not support passkeys here. On Windows, turn on “Save passkeys to this Windows device” in your browser settings and try again. Or use your password.",',
    "ru": 'passkeyUnavailable: "Этот браузер не поддерживает ключи доступа здесь. В Windows включите «Save passkeys to this Windows device» в настройках браузера и попробуйте ещё раз. Или используйте пароль.",',
    "es": 'passkeyUnavailable: "Este navegador no admite claves de acceso aquí. En Windows, activa «Save passkeys to this Windows device» en los ajustes del navegador e inténtalo de nuevo. O usa tu contraseña.",',
    "de": 'passkeyUnavailable: "Dieser Browser unterstützt hier keine Passkeys. Aktiviere unter Windows in den Browsereinstellungen «Save passkeys to this Windows device» und versuche es erneut. Oder verwende dein Passwort.",',
    "fr": 'passkeyUnavailable: "Ce navigateur ne prend pas en charge les clés d’accès ici. Sous Windows, activez « Save passkeys to this Windows device » dans les paramètres du navigateur, puis réessayez. Ou utilisez votre mot de passe.",',
    "pt": '"passkeyUnavailable": "Este navegador não suporta chaves de acesso aqui. No Windows, ative «Save passkeys to this Windows device» nas definições do navegador e tente novamente. Ou use sua senha.",',
}

P = "src/lib/i18n/dictionaries.ts"
text = open(P, encoding="utf-8").read()
for locale in ("en", "ru", "es", "de", "fr", "pt"):
    old = OLD[locale]
    assert text.count(old) == 1, f"{locale}: old passkeyUnavailable found {text.count(old)} times, expected 1"
    text = text.replace(old, NEW[locale])
    print(f"updated passkeyUnavailable ({locale})")
open(P, "w", encoding="utf-8").write(text)
print("done")
