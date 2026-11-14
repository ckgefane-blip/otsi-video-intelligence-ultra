#!/usr/bin/env python3
"""Insert the user-to-user Invite strings into dictionaries.ts (type + 6 locales).

Keys added (each must end up at exactly 7 occurrences: 1 type + 6 locales):
  body.wallet: kindInviteBonus, kindInviteReward (+2 -> 299)
  body.shell:  invite (+1 -> 293)
  body.invite: title, sub, linkLabel, codeLabel, copy, copied, inviteeGets,
               inviterGets, loading, loadFailed, signupBonus (11, new group)
Insert bottom-to-top; anchors are the DISTINCT last-key lines of each group
(pt uses quoted keys, and omits the last key's trailing comma).
Run from the repo root: python3 otsi-vie/apps/web/scripts/invite-i18n-insert.py
"""
import pathlib
import sys

PATH = pathlib.Path(__file__).resolve().parents[1] / "src/lib/i18n/dictionaries.ts"

INVITE = {
    "en": {
        "title": "Invite friends, earn tokens",
        "sub": "Share your invite link with a friend. When they join and do something real, you both get free tokens.",
        "linkLabel": "Your invite link",
        "codeLabel": "Invite code",
        "copy": "Copy link",
        "copied": "Link copied",
        "inviteeGets": "Your friend gets +{bonus} tokens on signup \u2014 on top of the 100-token free grant.",
        "inviterGets": "You get +{reward} tokens when they analyse their first match or buy their first pack.",
        "loading": "Loading your invite link\u2026",
        "loadFailed": "Could not load your invite link.",
        "signupBonus": "You were invited \u2014 you get +{bonus} tokens on signup, on top of the 100-token free grant.",
    },
    "ru": {
        "title": "\u041f\u0440\u0438\u0433\u043b\u0430\u0448\u0430\u0439\u0442\u0435 \u0434\u0440\u0443\u0437\u0435\u0439 \u0438 \u043f\u043e\u043b\u0443\u0447\u0430\u0439\u0442\u0435 \u0442\u043e\u043a\u0435\u043d\u044b",
        "sub": "\u041f\u043e\u0434\u0435\u043b\u0438\u0442\u0435\u0441\u044c \u0441\u0441\u044b\u043b\u043a\u043e\u0439-\u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435\u043c \u0441 \u0434\u0440\u0443\u0433\u043e\u043c. \u041a\u043e\u0433\u0434\u0430 \u043e\u043d \u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0438\u0442\u0441\u044f \u0438 \u0441\u0434\u0435\u043b\u0430\u0435\u0442 \u0447\u0442\u043e-\u0442\u043e \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0435, \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u0435 \u0442\u043e\u043a\u0435\u043d\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u0432\u044b \u043e\u0431\u0430.",
        "linkLabel": "\u0412\u0430\u0448\u0430 \u0441\u0441\u044b\u043b\u043a\u0430-\u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435",
        "codeLabel": "\u041a\u043e\u0434 \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f",
        "copy": "\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443",
        "copied": "\u0421\u0441\u044b\u043b\u043a\u0430 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0430",
        "inviteeGets": "\u0412\u0430\u0448 \u0434\u0440\u0443\u0433 \u043f\u043e\u043b\u0443\u0447\u0438\u0442 +{bonus} \u0442\u043e\u043a\u0435\u043d\u043e\u0432 \u043f\u0440\u0438 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438 \u2014 \u0432\u0434\u043e\u0431\u0430\u0432\u043e\u043a \u043a \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u043c 100 \u0442\u043e\u043a\u0435\u043d\u0430\u043c.",
        "inviterGets": "\u0412\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 +{reward} \u0442\u043e\u043a\u0435\u043d\u043e\u0432, \u043a\u043e\u0433\u0434\u0430 \u043e\u043d \u043f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u0435\u0442 \u0441\u0432\u043e\u0439 \u043f\u0435\u0440\u0432\u044b\u0439 \u043c\u0430\u0442\u0447 \u0438\u043b\u0438 \u043a\u0443\u043f\u0438\u0442 \u043f\u0435\u0440\u0432\u044b\u0439 \u043f\u0430\u043a\u0435\u0442.",
        "loading": "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0441\u0441\u044b\u043b\u043a\u0438-\u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f\u2026",
        "loadFailed": "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443-\u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435.",
        "signupBonus": "\u0412\u0430\u0441 \u043f\u0440\u0438\u0433\u043b\u0430\u0441\u0438\u043b\u0438 \u2014 \u0432\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 +{bonus} \u0442\u043e\u043a\u0435\u043d\u043e\u0432 \u043f\u0440\u0438 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438, \u0432\u0434\u043e\u0431\u0430\u0432\u043e\u043a \u043a \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u043c 100 \u0442\u043e\u043a\u0435\u043d\u0430\u043c.",
    },
    "es": {
        "title": "Invita a amigos y gana tokens",
        "sub": "Comparte tu enlace de invitaci\u00f3n con un amigo. Cuando se una y haga algo real, ambos recibir\u00e1n tokens gratis.",
        "linkLabel": "Tu enlace de invitaci\u00f3n",
        "codeLabel": "C\u00f3digo de invitaci\u00f3n",
        "copy": "Copiar enlace",
        "copied": "Enlace copiado",
        "inviteeGets": "Tu amigo recibe +{bonus} tokens al registrarse, adem\u00e1s de los 100 tokens gratis.",
        "inviterGets": "T\u00fa recibes +{reward} tokens cuando analice su primer partido o compre su primer paquete.",
        "loading": "Cargando tu enlace de invitaci\u00f3n\u2026",
        "loadFailed": "No se pudo cargar tu enlace de invitaci\u00f3n.",
        "signupBonus": "Te invitaron: recibir\u00e1s +{bonus} tokens al registrarte, adem\u00e1s de los 100 tokens gratis.",
    },
    "de": {
        "title": "Freunde einladen, Tokens verdienen",
        "sub": "Teile deinen Einladungslink mit einem Freund. Wenn er beitritt und etwas Echtes tut, bekommt ihr beide kostenlose Tokens.",
        "linkLabel": "Dein Einladungslink",
        "codeLabel": "Einladungscode",
        "copy": "Link kopieren",
        "copied": "Link kopiert",
        "inviteeGets": "Dein Freund erh\u00e4lt +{bonus} Tokens bei der Anmeldung \u2014 zus\u00e4tzlich zu den 100 kostenlosen Tokens.",
        "inviterGets": "Du erh\u00e4ltst +{reward} Tokens, wenn er sein erstes Spiel analysiert oder sein erstes Paket kauft.",
        "loading": "Einladungslink wird geladen\u2026",
        "loadFailed": "Dein Einladungslink konnte nicht geladen werden.",
        "signupBonus": "Du wurdest eingeladen \u2014 du erh\u00e4ltst +{bonus} Tokens bei der Anmeldung, zus\u00e4tzlich zu den 100 kostenlosen Tokens.",
    },
    "fr": {
        "title": "Invitez vos amis, gagnez des jetons",
        "sub": "Partagez votre lien d'invitation avec un ami. Quand il s'inscrit et fait quelque chose de concret, vous recevez tous les deux des jetons gratuits.",
        "linkLabel": "Votre lien d'invitation",
        "codeLabel": "Code d'invitation",
        "copy": "Copier le lien",
        "copied": "Lien copi\u00e9",
        "inviteeGets": "Votre ami re\u00e7oit +{bonus} jetons \u00e0 l'inscription, en plus des 100 jetons gratuits.",
        "inviterGets": "Vous recevez +{reward} jetons quand il analyse son premier match ou ach\u00e8te son premier pack.",
        "loading": "Chargement de votre lien d'invitation\u2026",
        "loadFailed": "Impossible de charger votre lien d'invitation.",
        "signupBonus": "Vous avez \u00e9t\u00e9 invit\u00e9 \u2014 vous recevez +{bonus} jetons \u00e0 l'inscription, en plus des 100 jetons gratuits.",
    },
    "pt": {
        "title": "Convide amigos e ganhe tokens",
        "sub": "Partilhe o seu link de convite com um amigo. Quando ele aderir e fizer algo real, ambos recebem tokens gr\u00e1tis.",
        "linkLabel": "O seu link de convite",
        "codeLabel": "C\u00f3digo de convite",
        "copy": "Copiar link",
        "copied": "Link copiado",
        "inviteeGets": "O seu amigo recebe +{bonus} tokens ao registar-se, al\u00e9m dos 100 tokens gr\u00e1tis.",
        "inviterGets": "Voc\u00ea recebe +{reward} tokens quando ele analisar o primeiro jogo ou comprar o primeiro pacote.",
        "loading": "A carregar o seu link de convite\u2026",
        "loadFailed": "N\u00e3o foi poss\u00edvel carregar o seu link de convite.",
        "signupBonus": "Voc\u00ea foi convidado \u2014 recebe +{bonus} tokens ao registar-se, al\u00e9m dos 100 tokens gr\u00e1tis.",
    },
}

WALLET = {
    "en": {"kindInviteBonus": "Invite bonus", "kindInviteReward": "Invite reward"},
    "ru": {"kindInviteBonus": "\u0411\u043e\u043d\u0443\u0441 \u0437\u0430 \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435", "kindInviteReward": "\u041d\u0430\u0433\u0440\u0430\u0434\u0430 \u0437\u0430 \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435"},
    "es": {"kindInviteBonus": "Bono por invitaci\u00f3n", "kindInviteReward": "Recompensa por invitaci\u00f3n"},
    "de": {"kindInviteBonus": "Einladungsbonus", "kindInviteReward": "Einladungsbelohnung"},
    "fr": {"kindInviteBonus": "Bonus d'invitation", "kindInviteReward": "R\u00e9compense d'invitation"},
    "pt": {"kindInviteBonus": "B\u00f3nus de convite", "kindInviteReward": "Recompensa de convite"},
}

SHELL = {
    "en": "Invite friends",
    "ru": "\u041f\u0440\u0438\u0433\u043b\u0430\u0441\u0438\u0442\u044c \u0434\u0440\u0443\u0437\u0435\u0439",
    "es": "Invitar amigos",
    "de": "Freunde einladen",
    "fr": "Inviter des amis",
    "pt": "Convidar amigos",
}

# last-key anchors of each group, per locale (verified unique with grep -c -F)
WALLET_ANCHOR = {
    "en": '      cpRenderBatchMany: "Render {a} files",',
    "ru": '      cpRenderBatchMany: "\u041e\u0442\u0440\u0435\u043d\u0434\u0435\u0440\u0438\u0442\u044c {a} \u0444\u0430\u0439\u043b\u043e\u0432",',
    "es": '      cpRenderBatchMany: "Renderizar {a} archivos",',
    "de": '      cpRenderBatchMany: "{a} Dateien rendern",',
    "fr": '      cpRenderBatchMany: "Rendre {a} fichiers",',
    "pt": '      "cpRenderBatchMany": "Renderizar {a} arquivos",',
}
SHELL_ANCHOR = {
    "en": '      ksSelectTool: "Select tool",',
    "ru": '      ksSelectTool: "\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u00ab\u0412\u044b\u0431\u043e\u0440\u00bb",',
    "es": '      ksSelectTool: "Herramienta de selecci\u00f3n",',
    "de": '      ksSelectTool: "Auswahl-Werkzeug",',
    "fr": '      ksSelectTool: "Outil de s\u00e9lection",',
    "pt": '      "ksSelectTool": "Ferramenta de sele\u00e7\u00e3o",',
}
AUTH_ANCHOR = {
    "en": '      hidePasswordShort: "Hide",',
    "ru": '      hidePasswordShort: "\u0421\u043a\u0440\u044b\u0442\u044c",',
    "es": '      hidePasswordShort: "Ocultar",',
    "de": '      hidePasswordShort: "Ausblenden",',
    "fr": '      hidePasswordShort: "Masquer",',
    "pt": '      "hidePasswordShort": "Ocultar",',
}

KEYS = list(INVITE["en"].keys())


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def insert_once(text: str, anchor: str, addition: str) -> str:
    assert text.count(anchor) == 1, f"anchor not unique: {anchor[:60]!r} (found {text.count(anchor)})"
    return text.replace(anchor, anchor + addition, 1)


def main() -> int:
    text = PATH.read_text(encoding="utf-8")
    # --- the Dictionary type: wallet + shell keys, then the invite group ---
    text = insert_once(text, "      cpRenderBatchMany: string;",
                       "\n      kindInviteBonus: string;\n      kindInviteReward: string;")
    text = insert_once(text, "      ksSelectTool: string;", "\n      invite: string;")
    invite_type = "\n    invite: {\n" + "".join(f"      {k}: string;\n" for k in KEYS) + "    };"
    text = insert_once(text, "    windowsHello: string;\n  };", invite_type)
    # --- each locale, bottom-to-top (invite group, shell key, wallet keys) ---
    for loc in ("pt", "fr", "de", "es", "ru", "en"):
        quoted = loc == "pt"
        q = '"' if quoted else ""
        # invite group after the auth group's close
        auth_anchor = AUTH_ANCHOR[loc]
        keys = "".join(
            f'      {q}{k}{q}: "{esc(INVITE[loc][k])}"{"," if i < len(KEYS) - 1 or not quoted else ""}\n'
            for i, k in enumerate(KEYS)
        )
        if quoted:
            # pt's auth group closes without a comma (last group in body)
            old = auth_anchor + "\n    }"
            new = auth_anchor + "\n    },\n    \"invite\": {\n" + keys + "    }"
            assert text.count(old) == 1, f"pt auth close not unique"
            text = text.replace(old, new, 1)
        else:
            old = auth_anchor + "\n    },"
            new = auth_anchor + "\n    },\n    invite: {\n" + keys + "    },"
            assert text.count(old) == 1, f"{loc} auth close not unique"
            text = text.replace(old, new, 1)
        # shell key
        text = insert_once(text, SHELL_ANCHOR[loc],
                           f'\n      {q}invite{q}: "{esc(SHELL[loc])}",')
        # wallet keys
        w = WALLET[loc]
        text = insert_once(text, WALLET_ANCHOR[loc],
                           f'\n      {q}kindInviteBonus{q}: "{esc(w["kindInviteBonus"])}",'
                           f'\n      {q}kindInviteReward{q}: "{esc(w["kindInviteReward"])}",')
    PATH.write_text(text, encoding="utf-8")
    # --- verify: every new key at exactly 7 occurrences (1 type + 6 locales) ---
    # The invite-group key names (title, sub, copy, ...) are common words, so they are counted
    # by group header instead; the repo's i18n test counts body.invite.* per locale.
    final = PATH.read_text(encoding="utf-8")
    bad = []
    headers = final.count("    invite: {") + final.count('    "invite": {')
    if headers != 7:
        bad.append(("invite group headers", headers))
    for k in ("kindInviteBonus", "kindInviteReward"):
        n = final.count(k)
        if n != 7:
            bad.append((k, n))
    shell_n = (final.count("      invite: string;")
               + sum(final.count(f'      invite: "{esc(SHELL[loc])}",') for loc in ("en", "ru", "es", "de", "fr"))
               + final.count(f'      "invite": "{esc(SHELL["pt"])}",'))
    if shell_n != 7:
        bad.append(("shell invite", shell_n))
    if bad:
        print("MISMATCH:", bad)
        return 1
    print("OK: invite group headers, kind keys and shell key each at 7 occurrences")
    return 0


if __name__ == "__main__":
    sys.exit(main())
