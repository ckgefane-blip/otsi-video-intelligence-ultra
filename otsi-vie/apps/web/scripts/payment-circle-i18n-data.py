# -*- coding: utf-8 -*-
"""Payment circle i18n data (ADR-144, ultra-only): the new wallet-group keys for Plans & billing, the order
invoice / proof / receipt, the admin billing console, and the 25 -> 100 free-grant value updates.
Each key: {en, ru, es, de, fr, pt} with real translations and matching {placeholders}."""
BILLING_KEYS = {
    "wlBillingNav": {
        "en": "Plans & billing", "ru": "Тарифы и оплата", "es": "Planes y facturación",
        "de": "Tarife & Abrechnung", "fr": "Forfaits et facturation", "pt": "Planos e faturamento",
    },
    "wlFreeCovers": {
        "en": "One full match + one reel — your first match free.",
        "ru": "Один полный матч и один ролик — ваш первый матч бесплатно.",
        "es": "Un partido completo y un reel: tu primer partido gratis.",
        "de": "Ein ganzes Spiel und ein Reel — Ihr erstes Spiel kostenlos.",
        "fr": "Un match complet et un reel — votre premier match gratuit.",
        "pt": "Uma partida completa e um reel — a sua primeira partida grátis.",
    },
    "wlShowPay": {
        "en": "Show payment details", "ru": "Показать реквизиты оплаты", "es": "Mostrar datos de pago",
        "de": "Zahlungsdaten anzeigen", "fr": "Afficher les coordonnées de paiement", "pt": "Mostrar dados de pagamento",
    },
    "wlHidePay": {
        "en": "Hide payment details", "ru": "Скрыть реквизиты оплаты", "es": "Ocultar datos de pago",
        "de": "Zahlungsdaten ausblenden", "fr": "Masquer les coordonnées de paiement", "pt": "Ocultar dados de pagamento",
    },
    "wlPayHow": {
        "en": "How to pay", "ru": "Как оплатить", "es": "Cómo pagar",
        "de": "So bezahlen Sie", "fr": "Comment payer", "pt": "Como pagar",
    },
    "wlBankNotSet": {
        "en": "Bank details are not set yet. Ask the owner.",
        "ru": "Банковские реквизиты ещё не заданы. Обратитесь к владельцу.",
        "es": "Los datos bancarios aún no están configurados. Pregunta al propietario.",
        "de": "Bankdaten sind noch nicht hinterlegt. Bitte wenden Sie sich an den Eigentümer.",
        "fr": "Les coordonnées bancaires ne sont pas encore définies. Demandez au propriétaire.",
        "pt": "Os dados bancários ainda não foram definidos. Pergunte ao proprietário.",
    },
    "wlInvoicePending": {
        "en": "The invoice is being prepared. Bank details will appear here once issued.",
        "ru": "Счёт готовится. Банковские реквизиты появятся здесь после выставления.",
        "es": "La factura se está preparando. Los datos bancarios aparecerán aquí cuando se emita.",
        "de": "Die Rechnung wird vorbereitet. Die Bankdaten erscheinen hier, sobald sie ausgestellt ist.",
        "fr": "La facture est en cours de préparation. Les coordonnées bancaires apparaîtront ici une fois émise.",
        "pt": "A fatura está sendo preparada. Os dados bancários aparecerão aqui quando for emitida.",
    },
    "blTitle": {
        "en": "Plans & billing", "ru": "Тарифы и оплата", "es": "Planes y facturación",
        "de": "Tarife & Abrechnung", "fr": "Forfaits et facturation", "pt": "Planos e faturamento",
    },
    "blSubtitle": {
        "en": "Choose a plan, pay by bank transfer, and follow the order. Prices come from the server — nothing here is typed in.",
        "ru": "Выберите тариф, оплатите банковским переводом и следите за заказом. Цены приходят с сервера — здесь ничего не вводится вручную.",
        "es": "Elige un plan, paga por transferencia bancaria y sigue el pedido. Los precios vienen del servidor: aquí no se escribe nada a mano.",
        "de": "Wählen Sie einen Tarif, zahlen Sie per Banküberweisung und verfolgen Sie die Bestellung. Die Preise kommen vom Server — hier wird nichts von Hand eingetragen.",
        "fr": "Choisissez un forfait, payez par virement bancaire et suivez la commande. Les prix viennent du serveur — rien n’est saisi ici à la main.",
        "pt": "Escolha um plano, pague por transferência bancária e acompanhe o pedido. Os preços vêm do servidor — nada aqui é digitado à mão.",
    },
    "blChoosePlan": {
        "en": "Choose a plan", "ru": "Выберите тариф", "es": "Elige un plan",
        "de": "Tarif wählen", "fr": "Choisissez un forfait", "pt": "Escolha um plano",
    },
    "blMonthly": {
        "en": "Monthly", "ru": "Ежемесячно", "es": "Mensual",
        "de": "Monatlich", "fr": "Mensuel", "pt": "Mensal",
    },
    "blTwelve": {
        "en": "12 months (2 months free)", "ru": "12 месяцев (2 месяца бесплатно)", "es": "12 meses (2 meses gratis)",
        "de": "12 Monate (2 Monate gratis)", "fr": "12 mois (2 mois offerts)", "pt": "12 meses (2 meses grátis)",
    },
    "blTokensPerMonth": {
        "en": "Tokens per month", "ru": "Токенов в месяц", "es": "Tokens al mes",
        "de": "Token pro Monat", "fr": "Jetons par mois", "pt": "Tokens por mês",
    },
    "blPeriodTokens": {
        "en": "{a} tokens for the selected period", "ru": "{a} токенов за выбранный период", "es": "{a} tokens para el período seleccionado",
        "de": "{a} Token für den gewählten Zeitraum", "fr": "{a} jetons pour la période choisie", "pt": "{a} tokens para o período selecionado",
    },
    "blOrderBtn": {
        "en": "Order by bank transfer", "ru": "Заказать банковским переводом", "es": "Pedir por transferencia bancaria",
        "de": "Per Banküberweisung bestellen", "fr": "Commander par virement bancaire", "pt": "Pedir por transferência bancária",
    },
    "blPayOnline": {
        "en": "Pay online — coming soon", "ru": "Оплата онлайн — скоро", "es": "Pagar en línea — próximamente",
        "de": "Online bezahlen — bald verfügbar", "fr": "Payer en ligne — bientôt disponible", "pt": "Pagar online — em breve",
    },
    "blPayOnlineNote": {
        "en": "Online card payment is coming soon. Bank transfer is available now.",
        "ru": "Онлайн-оплата картой появится скоро. Сейчас доступен банковский перевод.",
        "es": "El pago con tarjeta en línea llegará pronto. La transferencia bancaria está disponible ahora.",
        "de": "Online-Kartenzahlung kommt bald. Banküberweisung ist jetzt verfügbar.",
        "fr": "Le paiement par carte en ligne arrive bientôt. Le virement bancaire est disponible dès maintenant.",
        "pt": "O pagamento com cartão online chegará em breve. A transferência bancária já está disponível.",
    },
    "blYourOrders": {
        "en": "Your orders", "ru": "Ваши заказы", "es": "Tus pedidos",
        "de": "Ihre Bestellungen", "fr": "Vos commandes", "pt": "Os seus pedidos",
    },
    "blNoOrders": {
        "en": "No orders yet", "ru": "Заказов пока нет", "es": "Aún no hay pedidos",
        "de": "Noch keine Bestellungen", "fr": "Aucune commande pour l’instant", "pt": "Ainda não há pedidos",
    },
    "blNoOrdersHint": {
        "en": "Orders you place appear here with their invoice.",
        "ru": "Заказы, которые вы оформите, появятся здесь вместе со счётом.",
        "es": "Los pedidos que realices aparecerán aquí con su factura.",
        "de": "Bestellungen, die Sie aufgeben, erscheinen hier mit ihrer Rechnung.",
        "fr": "Les commandes que vous passez apparaissent ici avec leur facture.",
        "pt": "Os pedidos que você fizer aparecerão aqui com a fatura.",
    },
    "blOrderPlaced": {
        "en": "Order placed — pay by bank transfer", "ru": "Заказ оформлен — оплатите банковским переводом", "es": "Pedido realizado: paga por transferencia bancaria",
        "de": "Bestellung aufgegeben — per Banküberweisung zahlen", "fr": "Commande passée — payez par virement bancaire", "pt": "Pedido feito — pague por transferência bancária",
    },
    "blAwaiting": {
        "en": "Awaiting confirmation", "ru": "Ожидает подтверждения", "es": "Esperando confirmación",
        "de": "Warten auf Bestätigung", "fr": "En attente de confirmation", "pt": "Aguardando confirmação",
    },
    "blPartPaid": {
        "en": "Part paid — {a} of {b} received", "ru": "Частично оплачено — получено {a} из {b}", "es": "Pago parcial: {a} de {b} recibidos",
        "de": "Teilweise bezahlt — {a} von {b} erhalten", "fr": "Partiellement payé — {a} sur {b} reçus", "pt": "Parcialmente pago — {a} de {b} recebidos",
    },
    "blConfirmed": {
        "en": "Confirmed — plan active", "ru": "Подтверждено — тариф активен", "es": "Confirmado: plan activo",
        "de": "Bestätigt — Tarif aktiv", "fr": "Confirmé — forfait actif", "pt": "Confirmado — plano ativo",
    },
    "blRejected": {
        "en": "Rejected — {a}", "ru": "Отклонено — {a}", "es": "Rechazado: {a}",
        "de": "Abgelehnt — {a}", "fr": "Refusé — {a}", "pt": "Rejeitado — {a}",
    },
    "blRefunded": {
        "en": "Refunded", "ru": "Возвращено", "es": "Reembolsado",
        "de": "Erstattet", "fr": "Remboursé", "pt": "Reembolsado",
    },
    "blViewOrder": {
        "en": "View order", "ru": "Открыть заказ", "es": "Ver pedido",
        "de": "Bestellung ansehen", "fr": "Voir la commande", "pt": "Ver pedido",
    },
    "blSubscription": {
        "en": "Subscription", "ru": "Подписка", "es": "Suscripción",
        "de": "Abonnement", "fr": "Abonnement", "pt": "Assinatura",
    },
    "blPlanActiveUntil": {
        "en": "Plan active until {a}", "ru": "Тариф активен до {a}", "es": "Plan activo hasta el {a}",
        "de": "Tarif aktiv bis {a}", "fr": "Forfait actif jusqu’au {a}", "pt": "Plano ativo até {a}",
    },
    "blSubPastDue": {
        "en": "Past due — in the 14-day grace period", "ru": "Просрочено — действует 14-дневный льготный период", "es": "Vencido: en el período de gracia de 14 días",
        "de": "Überfällig — in der 14-tägigen Kulanzfrist", "fr": "En retard — dans le délai de grâce de 14 jours", "pt": "Vencido — no período de carência de 14 dias",
    },
    "blNoSubscription": {
        "en": "No active subscription", "ru": "Нет активной подписки", "es": "No hay suscripción activa",
        "de": "Kein aktives Abonnement", "fr": "Aucun abonnement actif", "pt": "Nenhuma assinatura ativa",
    },
    "blOrderCreated": {
        "en": "Order placed. Pay by bank transfer using the invoice below.",
        "ru": "Заказ оформлен. Оплатите банковским переводом по счёту ниже.",
        "es": "Pedido realizado. Paga por transferencia bancaria con la factura de abajo.",
        "de": "Bestellung aufgegeben. Zahlen Sie per Banküberweisung mit der Rechnung unten.",
        "fr": "Commande passée. Payez par virement bancaire avec la facture ci-dessous.",
        "pt": "Pedido feito. Pague por transferência bancária usando a fatura abaixo.",
    },
    "blNoBankAccount": {
        "en": "No bank account has been set up for {a} yet. Try the other currency, or ask the owner.",
        "ru": "Банковский счёт для {a} ещё не настроен. Попробуйте другую валюту или обратитесь к владельцу.",
        "es": "Aún no se ha configurado ninguna cuenta bancaria para {a}. Prueba con la otra moneda o pregunta al propietario.",
        "de": "Für {a} ist noch kein Bankkonto hinterlegt. Versuchen Sie die andere Währung oder wenden Sie sich an den Eigentümer.",
        "fr": "Aucun compte bancaire n’a encore été configuré pour {a}. Essayez l’autre devise ou demandez au propriétaire.",
        "pt": "Ainda não há conta bancária configurada para {a}. Tente a outra moeda ou pergunte ao proprietário.",
    },
    "blYourInvoice": {
        "en": "Your invoice", "ru": "Ваш счёт", "es": "Tu factura",
        "de": "Ihre Rechnung", "fr": "Votre facture", "pt": "A sua fatura",
    },
    "blBankDetails": {
        "en": "Bank details", "ru": "Банковские реквизиты", "es": "Datos bancarios",
        "de": "Bankdaten", "fr": "Coordonnées bancaires", "pt": "Dados bancários",
    },
    "blAccountName": {
        "en": "Account name", "ru": "Имя владельца счёта", "es": "Titular de la cuenta",
        "de": "Kontoinhaber", "fr": "Titulaire du compte", "pt": "Titular da conta",
    },
    "blBank": {
        "en": "Bank", "ru": "Банк", "es": "Banco",
        "de": "Bank", "fr": "Banque", "pt": "Banco",
    },
    "blAccountNumber": {
        "en": "Account number", "ru": "Номер счёта", "es": "Número de cuenta",
        "de": "Kontonummer", "fr": "Numéro de compte", "pt": "Número da conta",
    },
    "blSwift": {
        "en": "SWIFT / IBAN", "ru": "SWIFT / IBAN", "es": "SWIFT / IBAN",
        "de": "SWIFT / IBAN", "fr": "SWIFT / IBAN", "pt": "SWIFT / IBAN",
    },
    "blAmountToPay": {
        "en": "Amount to pay", "ru": "Сумма к оплате", "es": "Importe a pagar",
        "de": "Zu zahlender Betrag", "fr": "Montant à payer", "pt": "Valor a pagar",
    },
    "blOrderExpires": {
        "en": "Order expires", "ru": "Заказ истекает", "es": "El pedido caduca",
        "de": "Bestellung läuft ab", "fr": "La commande expire", "pt": "O pedido expira",
    },
    "blReference": {
        "en": "Reference", "ru": "Номер", "es": "Referencia",
        "de": "Referenz", "fr": "Référence", "pt": "Referência",
    },
    "blCopyRef": {
        "en": "Copy reference", "ru": "Скопировать номер", "es": "Copiar referencia",
        "de": "Referenz kopieren", "fr": "Copier la référence", "pt": "Copiar referência",
    },
    "blRefCopied": {
        "en": "Reference copied", "ru": "Номер скопирован", "es": "Referencia copiada",
        "de": "Referenz kopiert", "fr": "Référence copiée", "pt": "Referência copiada",
    },
    "blHavePaid": {
        "en": "I have paid", "ru": "Я оплатил", "es": "Ya he pagado",
        "de": "Ich habe bezahlt", "fr": "J’ai payé", "pt": "Já paguei",
    },
    "blMarkPaid": {
        "en": "Mark paid without a receipt", "ru": "Отметить оплаченным без квитанции", "es": "Marcar como pagado sin recibo",
        "de": "Als bezahlt markieren, ohne Beleg", "fr": "Marquer comme payé sans reçu", "pt": "Marcar como pago sem recibo",
    },
    "blPaidNote": {
        "en": "Anything the owner should know, e.g. the name the transfer was sent from",
        "ru": "Всё, что стоит знать владельцу, например имя, с которого отправлен перевод",
        "es": "Cualquier cosa que el propietario deba saber, por ejemplo, el nombre desde el que se envió la transferencia",
        "de": "Alles, was der Eigentümer wissen sollte, z. B. der Name, von dem die Überweisung gesendet wurde",
        "fr": "Tout ce que le propriétaire doit savoir, par exemple le nom depuis lequel le virement a été envoyé",
        "pt": "Qualquer coisa que o proprietário deva saber, por exemplo, o nome de onde a transferência foi enviada",
    },
    "blUploadReceipt": {
        "en": "Upload transfer receipt (PDF or image, up to 10 MB, optional)",
        "ru": "Загрузите квитанцию о переводе (PDF или изображение, до 10 МБ, необязательно)",
        "es": "Sube el comprobante de la transferencia (PDF o imagen, hasta 10 MB, opcional)",
        "de": "Überweisungsbeleg hochladen (PDF oder Bild, bis zu 10 MB, optional)",
        "fr": "Téléversez le reçu du virement (PDF ou image, jusqu’à 10 Mo, facultatif)",
        "pt": "Envie o comprovante da transferência (PDF ou imagem, até 10 MB, opcional)",
    },
    "blUploadBtn": {
        "en": "Upload receipt", "ru": "Загрузить квитанцию", "es": "Subir recibo",
        "de": "Beleg hochladen", "fr": "Téléverser le reçu", "pt": "Enviar recibo",
    },
    "blReceiptType": {
        "en": "A transfer receipt must be a PDF or an image (JPEG, PNG, WebP).",
        "ru": "Квитанция о переводе должна быть PDF или изображением (JPEG, PNG, WebP).",
        "es": "El comprobante de transferencia debe ser un PDF o una imagen (JPEG, PNG, WebP).",
        "de": "Ein Überweisungsbeleg muss ein PDF oder ein Bild sein (JPEG, PNG, WebP).",
        "fr": "Un reçu de virement doit être un PDF ou une image (JPEG, PNG, WebP).",
        "pt": "Um comprovante de transferência deve ser um PDF ou uma imagem (JPEG, PNG, WebP).",
    },
    "blReceiptSize": {
        "en": "A transfer receipt may be up to 10 MB.",
        "ru": "Квитанция о переводе может быть до 10 МБ.",
        "es": "El comprobante de transferencia puede tener hasta 10 MB.",
        "de": "Ein Überweisungsbeleg darf bis zu 10 MB groß sein.",
        "fr": "Un reçu de virement peut peser jusqu’à 10 Mo.",
        "pt": "Um comprovante de transferência pode ter até 10 MB.",
    },
    "blNoStorage": {
        "en": "Receipt storage is not configured on this server. Mark paid without a file instead, and send the receipt to the owner another way.",
        "ru": "Хранение квитанций на этом сервере не настроено. Отметьте оплату без файла, а квитанцию отправьте владельцу другим способом.",
        "es": "El almacenamiento de recibos no está configurado en este servidor. Marca como pagado sin archivo y envía el recibo al propietario por otro medio.",
        "de": "Die Belegablage ist auf diesem Server nicht eingerichtet. Markieren Sie stattdessen als bezahlt ohne Datei und senden Sie den Beleg dem Eigentümer auf anderem Weg.",
        "fr": "Le stockage des reçus n’est pas configuré sur ce serveur. Marquez comme payé sans fichier et envoyez le reçu au propriétaire par un autre moyen.",
        "pt": "O armazenamento de recibos não está configurado neste servidor. Marque como pago sem arquivo e envie o recibo ao proprietário por outro meio.",
    },
    "blOrderClosed": {
        "en": "This order is closed.", "ru": "Этот заказ закрыт.", "es": "Este pedido está cerrado.",
        "de": "Diese Bestellung ist geschlossen.", "fr": "Cette commande est clôturée.", "pt": "Este pedido está fechado.",
    },
    "blReceiptTitle": {
        "en": "Receipt", "ru": "Квитанция", "es": "Recibo",
        "de": "Quittung", "fr": "Reçu", "pt": "Recibo",
    },
    "blReceiptPaid": {
        "en": "Payment received", "ru": "Оплата получена", "es": "Pago recibido",
        "de": "Zahlung erhalten", "fr": "Paiement reçu", "pt": "Pagamento recebido",
    },
    "blDateConfirmed": {
        "en": "Date confirmed", "ru": "Дата подтверждения", "es": "Fecha de confirmación",
        "de": "Bestätigungsdatum", "fr": "Date de confirmation", "pt": "Data de confirmação",
    },
    "blTokensCredited": {
        "en": "Tokens credited", "ru": "Начислено токенов", "es": "Tokens acreditados",
        "de": "Gutgeschriebene Token", "fr": "Jetons crédités", "pt": "Tokens creditados",
    },
    "blPrintInvoice": {
        "en": "Print invoice", "ru": "Печать счёта", "es": "Imprimir factura",
        "de": "Rechnung drucken", "fr": "Imprimer la facture", "pt": "Imprimir fatura",
    },
    "blPrintReceipt": {
        "en": "Print receipt", "ru": "Печать квитанции", "es": "Imprimir recibo",
        "de": "Quittung drucken", "fr": "Imprimer le reçu", "pt": "Imprimir recibo",
    },
    "blOrderDate": {
        "en": "Ordered", "ru": "Заказано", "es": "Pedido",
        "de": "Bestellt", "fr": "Commandé", "pt": "Pedido",
    },
    "blPlan": {
        "en": "Plan", "ru": "Тариф", "es": "Plan",
        "de": "Tarif", "fr": "Forfait", "pt": "Plano",
    },
    "blMonth1": {
        "en": "1 month", "ru": "1 месяц", "es": "1 mes",
        "de": "1 Monat", "fr": "1 mois", "pt": "1 mês",
    },
    "blMonths12": {
        "en": "{a} months", "ru": "{a} мес.", "es": "{a} meses",
        "de": "{a} Monate", "fr": "{a} mois", "pt": "{a} meses",
    },
    "blProofFile": {
        "en": "Receipt file", "ru": "Файл квитанции", "es": "Archivo del recibo",
        "de": "Belegdatei", "fr": "Fichier du reçu", "pt": "Arquivo do recibo",
    },
    "blProofNote": {
        "en": "Note", "ru": "Примечание", "es": "Nota",
        "de": "Hinweis", "fr": "Note", "pt": "Nota",
    },
    "blAmountReceived": {
        "en": "Amount received", "ru": "Полученная сумма", "es": "Importe recibido",
        "de": "Erhaltener Betrag", "fr": "Montant reçu", "pt": "Valor recebido",
    },
    "blRemaining": {
        "en": "Remaining", "ru": "Осталось", "es": "Restante",
        "de": "Restbetrag", "fr": "Restant", "pt": "Restante",
    },
    "blBankRef": {
        "en": "Bank reference", "ru": "Банковская ссылка", "es": "Referencia bancaria",
        "de": "Bankreferenz", "fr": "Référence bancaire", "pt": "Referência bancária",
    },
    "blBackToOrders": {
        "en": "Back to orders", "ru": "Назад к заказам", "es": "Volver a los pedidos",
        "de": "Zurück zu den Bestellungen", "fr": "Retour aux commandes", "pt": "Voltar aos pedidos",
    },
    "blMarkedPaid": {
        "en": "Marked paid. The owner will confirm the transfer.",
        "ru": "Отмечено как оплаченное. Владелец подтвердит перевод.",
        "es": "Marcado como pagado. El propietario confirmará la transferencia.",
        "de": "Als bezahlt markiert. Der Eigentümer bestätigt die Überweisung.",
        "fr": "Marqué comme payé. Le propriétaire confirmera le virement.",
        "pt": "Marcado como pago. O proprietário confirmará a transferência.",
    },
    "blProofUploaded": {
        "en": "Receipt uploaded. The owner will confirm the transfer.",
        "ru": "Квитанция загружена. Владелец подтвердит перевод.",
        "es": "Recibo subido. El propietario confirmará la transferencia.",
        "de": "Beleg hochgeladen. Der Eigentümer bestätigt die Überweisung.",
        "fr": "Reçu téléversé. Le propriétaire confirmera le virement.",
        "pt": "Recibo enviado. O proprietário confirmará a transferência.",
    },
    "blAdminOrders": {
        "en": "Billing orders", "ru": "Заказы на оплату", "es": "Pedidos de facturación",
        "de": "Abrechnungsbestellungen", "fr": "Commandes de facturation", "pt": "Pedidos de faturamento",
    },
    "blConfirmPay": {
        "en": "Confirm payment", "ru": "Подтвердить оплату", "es": "Confirmar pago",
        "de": "Zahlung bestätigen", "fr": "Confirmer le paiement", "pt": "Confirmar pagamento",
    },
    "blRejectOrder": {
        "en": "Reject order", "ru": "Отклонить заказ", "es": "Rechazar pedido",
        "de": "Bestellung ablehnen", "fr": "Refuser la commande", "pt": "Rejeitar pedido",
    },
    "blRejectReason": {
        "en": "Rejection reason", "ru": "Причина отклонения", "es": "Motivo del rechazo",
        "de": "Ablehnungsgrund", "fr": "Motif du refus", "pt": "Motivo da rejeição",
    },
    "blRecordPartial": {
        "en": "Record part-payment", "ru": "Записать частичную оплату", "es": "Registrar pago parcial",
        "de": "Teilzahlung erfassen", "fr": "Enregistrer un acompte", "pt": "Registrar pagamento parcial",
    },
    "blRefund": {
        "en": "Refund", "ru": "Возврат", "es": "Reembolso",
        "de": "Erstattung", "fr": "Remboursement", "pt": "Reembolso",
    },
    "blRefundReason": {
        "en": "Refund reason", "ru": "Причина возврата", "es": "Motivo del reembolso",
        "de": "Erstattungsgrund", "fr": "Motif du remboursement", "pt": "Motivo do reembolso",
    },
    "blRefundNote": {
        "en": "The tokens the confirmation granted are clawed back from the wallet. If they were already spent, the refund is refused and the owner adjusts it manually.",
        "ru": "Токены, начисленные при подтверждении, списываются из кошелька. Если они уже потрачены, возврат отклоняется, и владелец корректирует его вручную.",
        "es": "Los tokens que concedió la confirmación se retiran de la billetera. Si ya se gastaron, el reembolso se rechaza y el propietario lo ajusta manualmente.",
        "de": "Die Token, die die Bestätigung gutgeschrieben hat, werden aus der Wallet zurückgebucht. Wurden sie bereits ausgegeben, wird die Erstattung abgelehnt und der Eigentümer korrigiert sie manuell.",
        "fr": "Les jetons accordés par la confirmation sont repris du portefeuille. S’ils ont déjà été dépensés, le remboursement est refusé et le propriétaire l’ajuste manuellement.",
        "pt": "Os tokens concedidos pela confirmação são retirados da carteira. Se já tiverem sido gastos, o reembolso é recusado e o proprietário ajusta manualmente.",
    },
    "blMoneyRefunded": {
        "en": "Money refunded", "ru": "Возвращённая сумма", "es": "Dinero reembolsado",
        "de": "Erstatteter Betrag", "fr": "Montant remboursé", "pt": "Valor reembolsado",
    },
    "blDateArrived": {
        "en": "Date money arrived", "ru": "Дата поступления денег", "es": "Fecha de llegada del dinero",
        "de": "Datum des Geldeingangs", "fr": "Date de réception des fonds", "pt": "Data de chegada do dinheiro",
    },
    "blAmountMustMatch": {
        "en": "The received amounts must add up to exactly the order amount.",
        "ru": "Полученные суммы должны в точности равняться сумме заказа.",
        "es": "Los importes recibidos deben sumar exactamente el importe del pedido.",
        "de": "Die erhaltenen Beträge müssen genau dem Bestellbetrag entsprechen.",
        "fr": "Les montants reçus doivent totaliser exactement le montant de la commande.",
        "pt": "Os valores recebidos devem somar exatamente o valor do pedido.",
    },
    "blOrderConfirmed": {
        "en": "Payment confirmed. The plan is active.",
        "ru": "Оплата подтверждена. Тариф активен.",
        "es": "Pago confirmado. El plan está activo.",
        "de": "Zahlung bestätigt. Der Tarif ist aktiv.",
        "fr": "Paiement confirmé. Le forfait est actif.",
        "pt": "Pagamento confirmado. O plano está ativo.",
    },
    "blOrderRejected": {
        "en": "Order rejected.", "ru": "Заказ отклонён.", "es": "Pedido rechazado.",
        "de": "Bestellung abgelehnt.", "fr": "Commande refusée.", "pt": "Pedido rejeitado.",
    },
    "blPartialRecorded": {
        "en": "Part-payment recorded.", "ru": "Частичная оплата записана.", "es": "Pago parcial registrado.",
        "de": "Teilzahlung erfasst.", "fr": "Acompte enregistré.", "pt": "Pagamento parcial registrado.",
    },
    "blRefundDone": {
        "en": "Refund recorded. The granted tokens were clawed back.",
        "ru": "Возврат записан. Начисленные токены списаны.",
        "es": "Reembolso registrado. Los tokens concedidos fueron retirados.",
        "de": "Erstattung erfasst. Die gutgeschriebenen Token wurden zurückgebucht.",
        "fr": "Remboursement enregistré. Les jetons accordés ont été repris.",
        "pt": "Reembolso registrado. Os tokens concedidos foram retirados.",
    },
    "blBankAccounts": {
        "en": "Bank accounts", "ru": "Банковские счета", "es": "Cuentas bancarias",
        "de": "Bankkonten", "fr": "Comptes bancaires", "pt": "Contas bancárias",
    },
    "blSaveBank": {
        "en": "Save bank details", "ru": "Сохранить реквизиты", "es": "Guardar datos bancarios",
        "de": "Bankdaten speichern", "fr": "Enregistrer les coordonnées bancaires", "pt": "Salvar dados bancários",
    },
    "blBankSaved": {
        "en": "Bank details saved", "ru": "Реквизиты сохранены", "es": "Datos bancarios guardados",
        "de": "Bankdaten gespeichert", "fr": "Coordonnées bancaires enregistrées", "pt": "Dados bancários salvos",
    },
    "blBankNote": {
        "en": "These are the bank details shown on every invoice. They are stored on the server only — never in the code.",
        "ru": "Это банковские реквизиты, которые указываются в каждом счёте. Они хранятся только на сервере — никогда в коде.",
        "es": "Estos son los datos bancarios que aparecen en cada factura. Se guardan solo en el servidor, nunca en el código.",
        "de": "Dies sind die Bankdaten, die auf jeder Rechnung stehen. Sie werden nur auf dem Server gespeichert — niemals im Code.",
        "fr": "Ce sont les coordonnées bancaires figurant sur chaque facture. Elles sont stockées sur le serveur uniquement — jamais dans le code.",
        "pt": "Estes são os dados bancários mostrados em cada fatura. Eles são armazenados apenas no servidor — nunca no código.",
    },
    "blBankActive": {
        "en": "Active", "ru": "Активен", "es": "Activo",
        "de": "Aktiv", "fr": "Actif", "pt": "Ativo",
    },
    "blBankInactive": {
        "en": "Inactive", "ru": "Неактивен", "es": "Inactivo",
        "de": "Inaktiv", "fr": "Inactif", "pt": "Inativo",
    },
    "blRenewals": {
        "en": "Renewals", "ru": "Продления", "es": "Renovaciones",
        "de": "Verlängerungen", "fr": "Renouvellements", "pt": "Renovações",
    },
    "blRunRenewals": {
        "en": "Run renewals now", "ru": "Запустить продления сейчас", "es": "Ejecutar renovaciones ahora",
        "de": "Verlängerungen jetzt ausführen", "fr": "Lancer les renouvellements maintenant", "pt": "Executar renovações agora",
    },
    "blRenewalNote": {
        "en": "Renewal orders are created 7 days before a subscription expires.",
        "ru": "Заказы на продление создаются за 7 дней до окончания подписки.",
        "es": "Los pedidos de renovación se crean 7 días antes de que caduque la suscripción.",
        "de": "Verlängerungsbestellungen werden 7 Tage vor Ablauf des Abonnements erstellt.",
        "fr": "Les commandes de renouvellement sont créées 7 jours avant l’expiration de l’abonnement.",
        "pt": "Os pedidos de renovação são criados 7 dias antes do vencimento da assinatura.",
    },
    "blGraceNote": {
        "en": "After expiry there is a 14-day grace period, then the plan drops to the free tier. Projects are kept.",
        "ru": "После окончания действует 14-дневный льготный период, затем тариф переходит на бесплатный. Проекты сохраняются.",
        "es": "Tras el vencimiento hay un período de gracia de 14 días; después el plan pasa al nivel gratuito. Los proyectos se conservan.",
        "de": "Nach Ablauf gibt es eine 14-tägige Kulanzfrist, dann fällt der Tarif auf die kostenlose Stufe. Projekte bleiben erhalten.",
        "fr": "Après l’expiration, il y a un délai de grâce de 14 jours, puis le forfait retombe au niveau gratuit. Les projets sont conservés.",
        "pt": "Após o vencimento, há um período de carência de 14 dias e depois o plano cai para o nível gratuito. Os projetos são mantidos.",
    },
    "blRenewalDailyNote": {
        "en": "The central server also runs this daily on its own — the button is for on-demand runs.",
        "ru": "Центральный сервер также запускает это ежедневно сам — кнопка для запусков по требованию.",
        "es": "El servidor central también lo ejecuta a diario por su cuenta; el botón es para ejecuciones bajo demanda.",
        "de": "Der zentrale Server führt dies auch täglich selbst aus — die Schaltfläche ist für Ausführungen bei Bedarf.",
        "fr": "Le serveur central l’exécute aussi chaque jour de lui-même — le bouton sert aux exécutions à la demande.",
        "pt": "O servidor central também executa isso diariamente por conta própria — o botão é para execuções sob demanda.",
    },
    "blRenewalsCreated": {
        "en": "{a} renewal order(s) created", "ru": "Создано заказов на продление: {a}", "es": "{a} pedido(s) de renovación creado(s)",
        "de": "{a} Verlängerungsbestellung(en) erstellt", "fr": "{a} commande(s) de renouvellement créée(s)", "pt": "{a} pedido(s) de renovação criado(s)",
    },
    "blDroppedFree": {
        "en": "{a} subscription(s) dropped to free", "ru": "Подписок переведено на бесплатный тариф: {a}", "es": "{a} suscripción(es) pasaron al nivel gratuito",
        "de": "{a} Abonnement(s) auf kostenlos zurückgestuft", "fr": "{a} abonnement(s) redescendu(s) au niveau gratuit", "pt": "{a} assinatura(s) rebaixada(s) para o gratuito",
    },
    "blPastDue": {
        "en": "{a} past due", "ru": "{a} просрочено", "es": "{a} vencido(s)",
        "de": "{a} überfällig", "fr": "{a} en retard", "pt": "{a} vencido(s)",
    },
    "blRenewalsDone": {
        "en": "Renewal run finished.", "ru": "Продления выполнены.", "es": "Ejecución de renovaciones terminada.",
        "de": "Verlängerungslauf abgeschlossen.", "fr": "Exécution des renouvellements terminée.", "pt": "Execução de renovações concluída.",
    },
    "blRevenue": {
        "en": "Revenue", "ru": "Выручка", "es": "Ingresos",
        "de": "Umsatz", "fr": "Revenus", "pt": "Receita",
    },
    "blRevConfirmed": {
        "en": "Confirmed (paid)", "ru": "Подтверждено (оплачено)", "es": "Confirmado (pagado)",
        "de": "Bestätigt (bezahlt)", "fr": "Confirmé (payé)", "pt": "Confirmado (pago)",
    },
    "blRevOutstanding": {
        "en": "Outstanding (awaiting confirmation)", "ru": "Ожидает (ждёт подтверждения)", "es": "Pendiente (esperando confirmación)",
        "de": "Ausstehend (wartet auf Bestätigung)", "fr": "En attente (en attente de confirmation)", "pt": "Pendente (aguardando confirmação)",
    },
    "blRevRefunded": {
        "en": "Refunded", "ru": "Возвращено", "es": "Reembolsado",
        "de": "Erstattet", "fr": "Remboursé", "pt": "Reembolsado",
    },
    "blRevPartial": {
        "en": "Part-payments", "ru": "Частичные оплаты", "es": "Pagos parciales",
        "de": "Teilzahlungen", "fr": "Acomptes", "pt": "Pagamentos parciais",
    },
    "blRevOrders": {
        "en": "{a} orders", "ru": "{a} заказов", "es": "{a} pedidos",
        "de": "{a} Bestellungen", "fr": "{a} commandes", "pt": "{a} pedidos",
    },
    "blProofDownload": {
        "en": "Download receipt", "ru": "Скачать квитанцию", "es": "Descargar recibo",
        "de": "Beleg herunterladen", "fr": "Télécharger le reçu", "pt": "Baixar recibo",
    },
    "blNoProof": {
        "en": "No receipt uploaded", "ru": "Квитанция не загружена", "es": "No se ha subido ningún recibo",
        "de": "Kein Beleg hochgeladen", "fr": "Aucun reçu téléversé", "pt": "Nenhum recibo enviado",
    },
}

# Free-grant 25 -> 100 value updates (owner-approved, ADR-140 revision): the existing keys keep their
# place; only the value changes, in all six locales. wlClaimFree ("Claim free grant") and wlFreeValid
# ("Valid 30 days. One per organisation.") carry no number and do not change.
FREE_GRANT_UPDATES = {
    "freeTitle": {
        "en": "Try it first — 100 free tokens", "ru": "Попробуйте сначала — 100 бесплатных токенов", "es": "Pruébalo primero: 100 tokens gratis",
        "de": "Erst ausprobieren — 100 kostenlose Token", "fr": "Essayez d’abord — 100 jetons gratuits", "pt": "Experimente primeiro — 100 tokens grátis",
    },
    "freeDesc": {
        "en": "100 tokens, once per organization: your first match free — one full match (90 tokens) plus one reel render (10 tokens) on your own footage. They expire 30 days after signup.",
        "ru": "100 токенов один раз на организацию: ваш первый матч бесплатно — один полный матч (90 токенов) плюс один ролик (10 токенов) на вашем видео. Они истекают через 30 дней после регистрации.",
        "es": "100 tokens, una vez por organización: tu primer partido gratis: un partido completo (90 tokens) más un reel (10 tokens) con tu propio metraje. Caducan 30 días después del registro.",
        "de": "100 Token einmal pro Organisation: Ihr erstes Spiel kostenlos — ein ganzes Spiel (90 Token) plus ein Reel (10 Token) mit eigenem Material. Sie verfallen 30 Tage nach der Registrierung.",
        "fr": "100 jetons, une fois par organisation : votre premier match gratuit — un match complet (90 jetons) plus un reel (10 jetons) avec vos propres séquences. Ils expirent 30 jours après l’inscription.",
        "pt": "100 tokens, uma vez por organização: a sua primeira partida grátis — uma partida completa (90 tokens) mais um reel (10 tokens) com as suas imagens. Eles expiram 30 dias após o cadastro.",
    },
    "claim": {
        "en": "Claim 100 free tokens", "ru": "Получить 100 бесплатных токенов", "es": "Reclamar 100 tokens gratis",
        "de": "100 kostenlose Token einlösen", "fr": "Récupérer 100 jetons gratuits", "pt": "Resgatar 100 tokens grátis",
    },
    "freeAdded": {
        "en": "100 free tokens added to the wallet.", "ru": "100 бесплатных токенов добавлены в кошелёк.", "es": "100 tokens gratis añadidos a la billetera.",
        "de": "100 kostenlose Token zur Wallet hinzugefügt.", "fr": "100 jetons gratuits ajoutés au portefeuille.", "pt": "100 tokens grátis adicionados à carteira.",
    },
    "wlFreeOnce": {
        "en": "100 tokens, once", "ru": "100 токенов, один раз", "es": "100 tokens, una vez",
        "de": "100 Token, einmalig", "fr": "100 jetons, une fois", "pt": "100 tokens, uma vez",
    },
}
