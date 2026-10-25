// ─────────────────────────────────────────────────────────────────────────────
// RECHTS-TEXTE (AGB + Widerrufsbelehrung) — Inhalt der Seiten /agb und /widerruf
// ─────────────────────────────────────────────────────────────────────────────
// Quelle: Freigabe-Fassungen im Freigabe-Ordner des Teams
// (`rechtstexte-freigabe-2026-10-25/AGB-DE.md` und `WIDERRUF-DE.md`).
// Übernommen maschinell mit `bun scripts/_legal-md-to-ts.ts <md> <EXPORT>`.
// Entfernt wurden ausschließlich Redaktions-Artefakte (interne Status-/OFFEN-
// Kästen, ⟨…⟩-Änderungsvermerke, „Bisherige Fassung"-Notizen) — der
// Vertragstext selbst ist unverändert.
//
// ⚠️ BETREIBER-ANGABEN: Die einzige Datenquelle für Name/Anschrift/E-Mail ist
//    `src/lib/legal.ts`. Im Text unten stehen sie ausgeschrieben, weil das der
//    freigegebene Wortlaut ist; bei einer Änderung müssen beide Stellen
//    mitgezogen werden (`legal-pages-test.ts` prüft die Übereinstimmung).
//
// ⚠️ ENGLISCHE FASSUNG FEHLT (offene Owner-Frage, Stand 2026-10-25): AGB und
//    Widerrufsbelehrung liegen nur auf Deutsch vor. Es wird KEINE Übersetzung
//    erfunden. Die englische Oberfläche zeigt deshalb einen Hinweis und den
//    deutschen Text (AGB § 16 Abs. 6: Vertragssprache ist Deutsch).
// ─────────────────────────────────────────────────────────────────────────────

/** Ein Inhaltsblock eines Rechtstexts. */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** Ausfülllinie im Muster-Widerrufsformular. */
  | { kind: 'blank' };

/** Ein Abschnitt (§ …) eines Rechtstexts. */
export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export const AGB_SECTIONS: LegalSection[] = [
  {
    "id": "1-geltungsbereich-und-vertragspartner",
    "title": "§ 1 Geltungsbereich und Vertragspartner",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Diese Allgemeinen Geschäftsbedingungen (nachfolgend „AGB\") gelten für alle Verträge über die Nutzung der Anwendung Growimo (nachfolgend „Dienst\") zwischen Katharina Fahr, Hauptstr. 38, 23619 Badendorf, Deutschland (nachfolgend „wir\" oder „Anbieter\") und den Nutzerinnen und Nutzern des Dienstes (nachfolgend „du\" oder „Nutzer\")."
      },
      {
        "kind": "p",
        "text": "(2) Der Dienst richtet sich an Verbraucherinnen und Verbraucher sowie an Unternehmer. Verbraucher ist jede natürliche Person, die ein Rechtsgeschäft zu Zwecken abschließt, die überwiegend weder ihrer gewerblichen noch ihrer selbständigen beruflichen Tätigkeit zugerechnet werden können (§ 13 BGB)."
      },
      {
        "kind": "p",
        "text": "(3) Abweichende, entgegenstehende oder ergänzende Allgemeine Geschäftsbedingungen werden nur dann Vertragsbestandteil, wenn wir ihrer Geltung ausdrücklich zugestimmt haben."
      },
      {
        "kind": "p",
        "text": "(4) Für die Nutzung des Dienstes gelten ergänzend die Datenschutzerklärung und die Widerrufsbelehrung in ihrer jeweils auf www.growimo.app veröffentlichten Fassung."
      }
    ]
  },
  {
    "id": "2-vertragsgegenstand",
    "title": "§ 2 Vertragsgegenstand",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Der Dienst ist eine webbasierte Software-Anwendung (SaaS), mit der du auf Grundlage deiner Eingaben KI-gestützt Marketing-Inhalte und Entscheidungshilfen erzeugen lassen kannst — unter anderem Pinterest-Pins, Etsy-Listings, SEO-Blogposts, Social-Posts, Newsletter, TikTok-Konzepte sowie Bilder."
      },
      {
        "kind": "p",
        "text": "(2) Der Dienst wird als Online-Anwendung bereitgestellt. Ein Erwerb von Software zur dauerhaften Installation ist nicht Gegenstand des Vertrages."
      },
      {
        "kind": "p",
        "text": "(3) Wir erbringen die Leistung mit kaufmännischer Sorgfalt. Ein bestimmter wirtschaftlicher Erfolg — etwa eine bestimmte Reichweite, Conversion oder Platzierung auf einer Plattform — wird nicht geschuldet und nicht zugesagt. Ergebnisse sind Vorschläge; die Prüfung und die Entscheidung über eine Veröffentlichung liegen bei dir."
      },
      {
        "kind": "p",
        "text": "(4) Der Dienst nutzt KI-Modelle Dritter (derzeit OpenAI). Wir können die eingesetzten Modelle und Anbieter austauschen, sofern dies die Leistung nicht wesentlich verschlechtert."
      }
    ]
  },
  {
    "id": "3-registrierung-und-nutzerkonto",
    "title": "§ 3 Registrierung und Nutzerkonto",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Für die Nutzung des Dienstes ist ein Nutzerkonto erforderlich. Die Registrierung erfolgt über die Anmeldung mit E-Mail-Adresse und Passwort. Mit dem Abschluss der Registrierung kommt ein Vertrag über die Nutzung des kostenlosen Tarifs zustande."
      },
      {
        "kind": "p",
        "text": "(2) Du bist verpflichtet, wahrheitsgemäße Angaben zu machen und deine Zugangsdaten geheim zu halten sowie vor dem Zugriff Dritter zu schützen. Die Nutzung des Kontos durch Dritte ist dir nicht gestattet; für Handlungen unter deinem Konto bist du verantwortlich, soweit du sie zu vertreten hast."
      },
      {
        "kind": "p",
        "text": "(3) Du musst mindestens 18 Jahre alt sein bzw. die nach dem Recht deines Aufenthaltsstaats erforderliche Volljährigkeit besitzen."
      },
      {
        "kind": "p",
        "text": "(4) Wir können die Registrierung ablehnen, wenn ein berechtigter Grund vorliegt — etwa bei einem Verstoß gegen diese AGB, bei missbräuchlicher Nutzung oder bei Anhaltspunkten für eine Umgehung von Nutzungsgrenzen."
      },
      {
        "kind": "p",
        "text": "(5) Du kannst die Löschung deines Kontos jederzeit per Nachricht an kontakt@growimo.app verlangen; wir löschen das Konto und die darin gespeicherten Inhalte anschließend nach Maßgabe der Datenschutzerklärung. Eine Löschung des Kontos beendet zugleich kostenpflichtige Abonnements; bereits abgerechnete Zeiträume werden nicht anteilig erstattet, soweit gesetzlich nichts anderes bestimmt ist."
      }
    ]
  },
  {
    "id": "4-leistungsumfang-generierungen-und-tarife",
    "title": "§ 4 Leistungsumfang, Generierungen und Tarife",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Der Dienst wird in folgenden Tarifen angeboten:"
      },
      {
        "kind": "table",
        "head": [
          "Tarif",
          "Preis",
          "Leistungsumfang"
        ],
        "rows": [
          [
            "Free",
            "0 €",
            "3 KI-Generierungen — einmalig pro Nutzerkonto (kein monatlicher Reset, kein Nachladen)"
          ],
          [
            "Pro (monatlich)",
            "19 € pro Monat",
            "200 Generierungen pro Abrechnungsmonat"
          ],
          [
            "Pro (Jahresplan)",
            "190 € pro Jahr",
            "200 Generierungen pro Abrechnungsmonat, abgerechnet für 12 Monate"
          ],
          [
            "Beta-Rabatt",
            "50 % auf Pro",
            "für E-Mail-Adressen, die vor dem öffentlichen Start als Beta-Nutzer registriert wurden (§ 6)"
          ]
        ]
      },
      {
        "kind": "p",
        "text": "(2) Eine „Generierung\" ist ein fertig erzeugtes Ergebnis. Für die Zuordnung gilt:"
      },
      {
        "kind": "list",
        "items": [
          "1 Bild = 1 Generierung.",
          "Ein Strategie-Paket verbraucht 1 Generierung pro enthaltenem Kanal.",
          "Die TikTok-Diagnose und A/B-Varianten verbrauchen je 1 Generierung.",
          "Keine zusätzliche Generierung verbrauchen: interne Wiederholungsversuche des Systems, die Bewertung/Scoring, das Verbessern eines bereits erzeugten Ergebnisses, das Wiederöffnen, Speichern oder Wiederherstellen von Ergebnissen.",
          "Es gibt keinen stillen Zusatzverbrauch: Der Verbrauch wird dir in der Anwendung angezeigt."
        ]
      },
      {
        "kind": "p",
        "text": "(3) Das Free-Kontingent von 3 Generierungen wird genau einmal pro Nutzerkonto gewährt. Es wird nicht monatlich und nicht nach einer Kündigung zurückgesetzt. Ist es verbraucht, sind KI-Funktionen nur noch mit einem kostenpflichtigen Abo (Pro) nutzbar. Nicht verbrauchte Generierungen sind nicht übertragbar."
      },
      {
        "kind": "p",
        "text": "Das Pro-Kontingent von 200 Generierungen gilt jeweils für einen Abrechnungsmonat; nicht verbrauchte Generierungen verfallen mit dem Kontingentwechsel und werden nicht übertragen."
      },
      {
        "kind": "p",
        "text": "(4) Ein Anspruch auf eine bestimmte Anzahl, Qualität oder Verfügbarkeit von KI-Systemen besteht nicht. Wir können die eingesetzten Modelle und Anbieter austauschen, sofern dies die Leistung nicht wesentlich verschlechtert. Ebenso können wir den Funktionsumfang weiterentwickeln, einzelne Funktionen ändern oder durch gleichwertige Funktionen ersetzen."
      },
      {
        "kind": "p",
        "text": "(5) Ist das Kontingent aufgebraucht, sind bis zum nächsten Kontingentwechsel (Pro) beziehungsweise bis zum Abschluss eines Pro-Abos (Free) keine weiteren KI-Generierungen möglich. Das Kontingent ist nicht übertragbar."
      },
      {
        "kind": "p",
        "text": "(6) Wir können die Preise und den Leistungsumfang mit Wirkung für die Zukunft ändern. Änderungen bei einem laufenden kostenpflichtigen Abonnement werden dir rechtzeitig vor Wirksamkeit mitgeteilt; du kannst das Abonnement in diesem Fall zum Zeitpunkt des Wirksamwerdens kündigen (§ 10 Abs. 4)."
      },
      {
        "kind": "p",
        "text": "(7) Ein Tarif mit unbegrenzten Generierungen wird nicht angeboten."
      }
    ]
  },
  {
    "id": "5-ergebnisse-speicherung-und-nutzungsrechte",
    "title": "§ 5 Ergebnisse, Speicherung und Nutzungsrechte",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Generierte Ergebnisse werden dir innerhalb der Anwendung im Projektbereich angezeigt. Über die Funktion „In Projekt speichern\" ordnest du ein Ergebnis dauerhaft deinem Projekt zu."
      },
      {
        "kind": "p",
        "text": "(2) Ergebnisse, die du nicht in einem Projekt speicherst, werden nur für die laufende Sitzung in deinem Browser vorgehalten (Sitzungsspeicher) und mit dem Schließen des Browser-Tabs bzw. des Browsers verworfen. Wir empfehlen, Ergebnisse, die du weiter nutzen möchtest, in einem Projekt zu speichern oder außerhalb des Dienstes zu sichern."
      },
      {
        "kind": "p",
        "text": "(3) Erzeugte Bilder werden in einem Objektspeicher abgelegt und spätestens 90 Tage nach ihrer Erstellung automatisch gelöscht. Zusätzlich gilt je Nutzerkonto eine Obergrenze von 200 gespeicherten Bildern; wird sie überschritten, werden die ältesten Bilder früher gelöscht. Sichere Bilder, die du dauerhaft benötigst, außerhalb des Dienstes."
      },
      {
        "kind": "p",
        "text": "(4) Soweit uns dies rechtlich möglich ist, räumen wir dir an den für dich erzeugten Ergebnissen ein einfaches Nutzungsrecht zur Verwendung für eigene Zwecke ein. Du bist für die Prüfung der Ergebnisse und für deren Nutzung selbst verantwortlich — insbesondere dafür, dass die Verwendung keine Rechte Dritter verletzt und den Vorgaben der Plattformen entspricht, auf denen du die Inhalte veröffentlichst."
      },
      {
        "kind": "p",
        "text": "(5) Wir garantieren nicht, dass generierte Inhalte frei von Schutzrechten Dritter sind, keinen Rechten Dritter entsprechen oder für einen bestimmten Zweck geeignet sind. Vor einer Veröffentlichung sind die Inhalte auf Richtigkeit und Zulässigkeit zu prüfen."
      }
    ]
  },
  {
    "id": "6-beta-rabatt",
    "title": "§ 6 Beta-Rabatt",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Nutzerinnen und Nutzer, die sich vor dem öffentlichen Start des Dienstes als Beta-Nutzer registriert haben, erhalten auf den Pro-Tarif einen Rabatt von 50 % (Coupon `BETA50`). In Stripe ist der Coupon als 50 % mit `duration = forever` hinterlegt, der Rabatt gilt also für die gesamte Laufzeit des Abonnements und nicht nur für die erste Zahlung."
      },
      {
        "kind": "p",
        "text": "(2) Maßgeblich für die Berechtigung ist die E-Mail-Adresse, die in der Beta-Warteliste mit dem Vermerk „freigegeben\" (`beta_signups.approved = true`) eingetragen ist. Der Rabatt wird bei jedem Bestellvorgang serverseitig neu geprüft: Stimmt die in deinem Konto hinterlegte E-Mail-Adresse mit einem freigegebenen Beta-Eintrag überein, wird der Rabatt automatisch angewendet; andernfalls wird der volle Preis berechnet. Einen Rabattcode musst und kannst du nicht selbst eingeben."
      },
      {
        "kind": "p",
        "text": "(3) Nach dem öffentlichen Start des Dienstes sind Neuregistrierungen als Beta-Nutzer nicht mehr möglich; entsprechende Anmeldungen werden nicht mehr angenommen. Bereits freigegebene Einträge bleiben unverändert bestehen."
      },
      {
        "kind": "p",
        "text": "(4) Erneuter Abschluss nach einer Kündigung. Kündigst du dein Pro-Abo und schließt später erneut ein Abo ab, wird der Rabatt erneut angewendet, solange die in deinem Konto hinterlegte E-Mail-Adresse weiterhin einem freigegebenen Beta-Eintrag entspricht. Der Rabatt ist nicht auf eine einmalige Einlösung beschränkt. Ein Anspruch auf den Rabatt für ein anderes Konto oder eine andere E-Mail-Adresse entsteht dadurch nicht."
      },
      {
        "kind": "p",
        "text": "(5) Änderung der E-Mail-Adresse. Wird die in deinem Konto hinterlegte E-Mail-Adresse geändert, ist ein Abgleich mit dem Beta-Eintrag nicht mehr möglich; der Rabatt wird dann nicht mehr angewendet. Melde dich in diesem Fall bitte vor dem Abschluss bei kontakt@growimo.app, damit wir die Berechtigung prüfen können."
      },
      {
        "kind": "p",
        "text": "(6) Eine Kombination mit anderen Aktionen oder Rabatten ist ausgeschlossen, soweit nicht ausdrücklich anders angegeben. Maßgeblich sind die Angaben im Bestellvorgang."
      }
    ]
  },
  {
    "id": "7-preise-zahlungsbedingungen-und-abrechnung",
    "title": "§ 7 Preise, Zahlungsbedingungen und Abrechnung",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Die Preise ergeben sich aus der Preisübersicht auf www.growimo.app und aus dem jeweils gültigen Tarif zum Zeitpunkt des Vertragsschlusses."
      },
      {
        "kind": "p",
        "text": "(2) Alle Preise sind Endpreise in Euro."
      },
      {
        "kind": "p",
        "text": "(3) Die Zahlung wird über den Zahlungsdienstleister Stripe abgewickelt. Die verfügbaren Zahlungsmittel ergeben sich aus dem Bestellvorgang. Zahlungsdaten gibst du unmittelbar bei dem Zahlungsdienstleister ein; wir speichern keine vollständigen Zahlungsdaten."
      },
      {
        "kind": "p",
        "text": "(4) Kostenpflichtige Abonnements werden im Voraus abgerechnet — der monatliche Tarif monatlich, der Jahresplan für den gewählten Jahreszeitraum — und verlängern sich automatisch um den jeweils gewählten Abrechnungszeitraum, wenn sie nicht vor Ablauf gekündigt werden."
      },
      {
        "kind": "p",
        "text": "(5) Rechnungen und Zahlungsbelege werden dir elektronisch über die Anwendung bzw. den Zahlungsdienstleister bereitgestellt."
      },
      {
        "kind": "p",
        "text": "(6) Gerätst du mit einer Zahlung in Verzug, sind wir berechtigt, den Dienst nach vorheriger Ankündigung vorübergehend zu sperren, bis die Zahlung eingeht. Gesetzliche Rechte bleiben unberührt."
      }
    ]
  },
  {
    "id": "8-verfuegbarkeit",
    "title": "§ 8 Verfügbarkeit",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Der Dienst wird über das Internet bereitgestellt. Eine ununterbrochene Verfügbarkeit wird nicht geschuldet; wir bemühen uns um eine hohe Verfügbarkeit."
      },
      {
        "kind": "p",
        "text": "(2) Wartungsarbeiten sowie Störungen, die außerhalb unseres Einflussbereichs liegen — insbesondere Ausfälle von Netzen, Rechenzentren oder der von uns eingesetzten Dienstleister sowie höhere Gewalt — können zu zeitweisen Einschränkungen führen. Wir werden zumutbare Anstrengungen unternehmen, Störungen zu beheben."
      },
      {
        "kind": "p",
        "text": "(3) Wir sind berechtigt, den Dienst aus wichtigem Grund vorübergehend zu sperren, insbesondere bei Sicherheitsvorfällen, Missbrauch oder Verstößen gegen diese AGB."
      }
    ]
  },
  {
    "id": "9-pflichten-und-zulaessige-nutzung",
    "title": "§ 9 Pflichten und zulässige Nutzung",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Du verpflichtest dich, den Dienst nicht missbräuchlich zu nutzen. Insbesondere ist es dir nicht gestattet,"
      },
      {
        "kind": "list",
        "items": [
          "rechtswidrige, diskriminierende, herabwürdigende oder täuschende Inhalte zu erzeugen oder zu verbreiten,",
          "Rechte Dritter (z. B. Urheber-, Marken- oder Persönlichkeitsrechte) zu verletzen,",
          "technische Schutz- oder Nutzungsbegrenzungen zu umgehen, Kontingente zu umgehen oder automatisiert Konten anzulegen,",
          "den Dienst automatisiert auszulesen, zu überlasten oder Sicherheitslücken auszunutzen,",
          "den Dienst weiterzuverkaufen oder Dritten ohne unsere Zustimmung gewerblichen Zugang zu verschaffen."
        ]
      },
      {
        "kind": "p",
        "text": "(2) Wir können bei einem erheblichen Verstoß gegen diese AGB das Konto nach vorheriger Abmahnung sperren oder den Vertrag aus wichtigem Grund kündigen. Gesetzliche Rechte bleiben unberührt."
      },
      {
        "kind": "p",
        "text": "(3) Die Verantwortung für die von dir eingegebenen Inhalte und für die Veröffentlichung generierter Inhalte trägt allein du."
      }
    ]
  },
  {
    "id": "10-laufzeit-und-kuendigung",
    "title": "§ 10 Laufzeit und Kündigung",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Der Vertrag über den kostenlosen Tarif läuft unbefristet und kann von beiden Seiten jederzeit ohne Frist beendet werden; die Löschung des Kontos genügt."
      },
      {
        "kind": "p",
        "text": "(2) Kostenpflichtige Abonnements laufen für den jeweils gewählten Abrechnungszeitraum und verlängern sich automatisch um denselben Zeitraum, sofern sie nicht vor Ablauf gekündigt werden."
      },
      {
        "kind": "p",
        "text": "(3) Die Kündigung ist jederzeit zum Ende des laufenden Abrechnungszeitraums möglich. Die Kündigung erfolgt über die Abrechnungsfunktion in der Anwendung bzw. über das Kundenportal des Zahlungsdienstleisters oder per E-Mail an kontakt@growimo.app. Nach einer Kündigung bleibt der Zugang bis zum Ende des bereits bezahlten Abrechnungszeitraums bestehen."
      },
      {
        "kind": "p",
        "text": "(4) Bereits gezahlte Entgelte für den laufenden Abrechnungszeitraum werden bei einer Kündigung nicht anteilig erstattet, soweit gesetzlich nichts anderes bestimmt ist (siehe hierzu die Widerrufsbelehrung)."
      },
      {
        "kind": "p",
        "text": "(5) Nach Beendigung des Vertrages löschen wir dein Konto und die darin gespeicherten Inhalte nach Maßgabe der Datenschutzerklärung. Wir empfehlen, Ergebnisse, die du aufbewahren möchtest, vor Beendigung zu sichern."
      },
      {
        "kind": "p",
        "text": "(6) Eine Kündigung aus wichtigem Grund bleibt beiden Seiten unbenommen."
      },
      {
        "kind": "p",
        "text": "(7) Kein Rückfall ins Free-Kontingent: Nach einer Kündigung oder nach Ablauf eines Pro-Abos werden die bereits verbrauchten 3 kostenlosen Generierungen nicht wiederhergestellt. Für weitere KI-Generierungen ist dann erneut ein Pro-Abo erforderlich."
      }
    ]
  },
  {
    "id": "11-widerrufsrecht-fuer-verbraucher",
    "title": "§ 11 Widerrufsrecht für Verbraucher",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Verbrauchern steht bei einem Fernabsatzvertrag ein gesetzliches Widerrufsrecht zu (§ 312g Abs. 1 BGB). Die Einzelheiten ergeben sich aus der Widerrufsbelehrung in ihrer jeweils auf www.growimo.app veröffentlichten Fassung."
      },
      {
        "kind": "p",
        "text": "(2) Die Widerrufsfrist beträgt vierzehn Tage. Sie beginnt bei einem Vertrag über eine Dienstleistung am Tag des Vertragsschlusses (§ 355 Abs. 1, § 356 Abs. 2 Nr. 1 Buchst. a BGB) — nicht erst mit einer Lieferung."
      },
      {
        "kind": "p",
        "text": "(3) Beginn vor Ablauf der Widerrufsfrist. Verlangst du ausdrücklich, dass wir mit der Erbringung der Leistung bereits vor Ablauf der Widerrufsfrist beginnen, und bestätigst du gleichzeitig, dass dir bekannt ist, dass du dadurch dein Widerrufsrecht verlierst, so erlischt dein Widerrufsrecht nach § 356 Abs. 5 BGB, sobald wir die Leistung vollständig erbracht haben. Bei einem laufzeitgebundenen Abonnement ist die Leistung erst mit Ablauf des gebuchten Abrechnungszeitraums vollständig erbracht."
      },
      {
        "kind": "p",
        "text": "(4) Bis zur vollständigen Erbringung bleibt dein Widerrufsrecht bestehen. Übst du es aus, hast du uns für die bis zur Mitteilung des Widerrufs bereits erbrachten Leistungen einen angemessenen Betrag zu zahlen (Wertersatz, § 357a Abs. 1 BGB). Maßstab ist der Anteil der bereits verbrauchten KI-Generierungen am Kontingent des gebuchten Abrechnungszeitraums; das Rechenbeispiel steht in der Widerrufsbelehrung."
      },
      {
        "kind": "p",
        "text": "(5) Ohne dein ausdrückliches Verlangen nach Absatz 3 beginnen wir nicht vor Ablauf der Widerrufsfrist. Dein Widerrufsrecht besteht dann für die vollen vierzehn Tage, und ein Wertersatz wird nicht geschuldet. Die bloße Nutzung des Dienstes gilt nicht als Verlangen nach Absatz 3 und lässt das Widerrufsrecht nicht erlöschen."
      },
      {
        "kind": "p",
        "text": "(6) Die Zustimmung nach Absatz 3 wird im Bestellvorgang gesondert abgefragt (Checkbox vor dem Kauf-Button) und mit Zeitpunkt und Textfassung dokumentiert."
      }
    ]
  },
  {
    "id": "12-gewaehrleistung-und-maengelhaftung",
    "title": "§ 12 Gewährleistung und Mängelhaftung",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Es gelten die gesetzlichen Vorschriften über Mängel- und Gewährleistungsrechte einschließlich der Regelungen über Verbraucherverträge über digitale Produkte."
      },
      {
        "kind": "p",
        "text": "(2) KI-generierte Ergebnisse sind naturgemäß nicht in jedem Einzelfall vorhersehbar. Eine Beschaffenheitsvereinbarung dahingehend, dass ein erzeugtes Ergebnis inhaltlich, stilistisch oder wirtschaftlich den Erwartungen entspricht oder für einen konkreten Zweck einsetzbar ist, wird nicht getroffen. Ein Mangel liegt vor, wenn die vereinbarte Leistung nicht erbracht wird — etwa wenn die Funktion insgesamt ausfällt oder Ergebnisse nicht wie beschrieben bereitgestellt werden."
      },
      {
        "kind": "p",
        "text": "(3) Du bist verpflichtet, uns Fehler unverzüglich mitzuteilen, damit wir sie beheben können."
      }
    ]
  },
  {
    "id": "13-haftung",
    "title": "§ 13 Haftung",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei schuldhafter Verletzung von Leben, Körper oder Gesundheit. Ebenso haften wir unbeschränkt nach dem Produkthaftungsgesetz und im Fall der Übernahme einer Garantie."
      },
      {
        "kind": "p",
        "text": "(2) Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten (Kardinalpflichten) ist die Haftung auf den vertragstypisch vorhersehbaren, unmittelbaren Schaden begrenzt. Wesentliche Vertragspflichten sind solche, deren Erfüllung die ordnungsgemäße Durchführung des Vertrages überhaupt erst ermöglicht und auf deren Einhaltung du regelmäßig vertrauen darfst."
      },
      {
        "kind": "p",
        "text": "(3) Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen."
      },
      {
        "kind": "p",
        "text": "(4) Wir haften nicht für Inhalte, die du auf Grundlage generierter Vorschläge veröffentlichst, und nicht für Entscheidungen, die du auf Grundlage von Bewertungen oder Hinweisen der Anwendung triffst. Die Prüfung und Verantwortung liegt bei dir (§ 5 Abs. 4 und 5, § 9 Abs. 3)."
      },
      {
        "kind": "p",
        "text": "(5) Wir haften nicht für Störungen oder Datenverluste, die wir nicht zu vertreten haben — etwa durch Ausfälle von Netzen, Rechenzentren oder Dienstleistern. Wir sind nicht verpflichtet, Daten zu sichern, die du nicht über die vorgesehenen Funktionen gespeichert hast (§ 5 Abs. 2 und 3)."
      },
      {
        "kind": "p",
        "text": "(6) Die vorstehenden Haftungsbeschränkungen gelten auch zugunsten unserer gesetzlichen Vertreter, Mitarbeiter und Erfüllungsgehilfen."
      }
    ]
  },
  {
    "id": "14-aenderungen-dieser-agb",
    "title": "§ 14 Änderungen dieser AGB",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Wir behalten uns vor, diese AGB mit Wirkung für die Zukunft zu ändern, sofern ein sachlicher Grund vorliegt — etwa wegen einer Änderung der Rechtslage, der Rechtsprechung, des Leistungsumfangs oder der technischen Gegebenheiten — und die Änderung für dich zumutbar ist."
      },
      {
        "kind": "p",
        "text": "(2) Änderungen werden dir rechtzeitig vor dem vorgesehenen Wirksamkeitsdatum in Textform mitgeteilt. Widersprichst du nicht innerhalb einer angemessenen Frist oder nutzt du den Dienst nach dem Wirksamkeitsdatum weiter, gelten die geänderten AGB als angenommen; hierauf werden wir dich in der Mitteilung gesondert hinweisen."
      },
      {
        "kind": "p",
        "text": "(3) Bei kostenpflichtigen Abonnements kannst du einer Änderung widersprechen und das Abonnement zum Wirksamkeitsdatum kündigen (§ 4 Abs. 6, § 10 Abs. 4)."
      }
    ]
  },
  {
    "id": "15-schlussbestimmungen",
    "title": "§ 15 Schlussbestimmungen",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Es gilt deutsches Recht. Sind Verbraucher beteiligt, bleiben die zwingenden verbraucherschützenden Vorschriften des Staates, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat, unberührt."
      },
      {
        "kind": "p",
        "text": "(2) Das Übereinkommen der Vereinten Nationen über Verträge über den internationalen Warenkauf (CISG) findet keine Anwendung."
      },
      {
        "kind": "p",
        "text": "(3) Ist der Nutzer kein Verbraucher, sondern Kaufmann, juristische Person des öffentlichen Rechts oder Sondervermögen des öffentlichen Rechts, ist Gerichtsstand der Sitz des Anbieters. Für Verbraucher gelten die gesetzlichen Gerichtsstände; eine Vereinbarung über den Gerichtsstand zu Lasten von Verbrauchern wird nur im Rahmen der gesetzlichen Zulässigkeit getroffen (insbesondere § 38 ZPO)."
      },
      {
        "kind": "p",
        "text": "(4) Angaben zur Verbraucherstreitbeilegung findest du im Impressum. Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG)."
      },
      {
        "kind": "p",
        "text": "(5) Sollten einzelne Bestimmungen dieser AGB unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung tritt die gesetzliche Regelung."
      },
      {
        "kind": "p",
        "text": "(6) Vertragssprache ist Deutsch. Die englischsprachige Oberfläche der Anwendung ist eine Bedienungshilfe; für den Vertrag ist die deutsche Fassung maßgeblich."
      },
      {
        "kind": "p",
        "text": "(7) Der Anbieter ist nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG)."
      }
    ]
  },
  {
    "id": "16-kontakt",
    "title": "§ 16 Kontakt",
    "blocks": [
      {
        "kind": "p",
        "text": "Katharina Fahr"
      },
      {
        "kind": "p",
        "text": "Hauptstr. 38"
      },
      {
        "kind": "p",
        "text": "23619 Badendorf"
      },
      {
        "kind": "p",
        "text": "Deutschland"
      },
      {
        "kind": "p",
        "text": "E-Mail: kontakt@growimo.app"
      }
    ]
  }
];

export const WIDERRUF_SECTIONS: LegalSection[] = [
  {
    "id": "widerrufsrecht",
    "title": "Widerrufsrecht",
    "blocks": [
      {
        "kind": "p",
        "text": "Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen."
      },
      {
        "kind": "p",
        "text": "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses."
      },
      {
        "kind": "p",
        "text": "Um dein Widerrufsrecht auszuüben, musst du uns"
      },
      {
        "kind": "p",
        "text": "Katharina Fahr"
      },
      {
        "kind": "p",
        "text": "Hauptstr. 38"
      },
      {
        "kind": "p",
        "text": "23619 Badendorf"
      },
      {
        "kind": "p",
        "text": "Deutschland"
      },
      {
        "kind": "p",
        "text": "E-Mail: kontakt@growimo.app"
      },
      {
        "kind": "p",
        "text": "mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist."
      },
      {
        "kind": "p",
        "text": "Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest."
      }
    ]
  },
  {
    "id": "widerrufsfolgen",
    "title": "Widerrufsfolgen",
    "blocks": [
      {
        "kind": "p",
        "text": "Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist."
      },
      {
        "kind": "p",
        "text": "Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet."
      }
    ]
  },
  {
    "id": "beginn-der-leistung-vor-ablauf-der-widerrufsfrist-konsequenzen",
    "title": "Beginn der Leistung vor Ablauf der Widerrufsfrist — Konsequenzen",
    "blocks": [
      {
        "kind": "p",
        "text": "(1) Wertersatz bei vorzeitigem Beginn. Verlangst du ausdrücklich, dass wir mit der Erbringung der Leistung bereits vor Ablauf der Widerrufsfrist beginnen, so hast du uns im Fall eines Widerrufs einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem du uns von der Ausübung des Widerrufsrechts unterrichtest, bereits erbrachten Leistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Leistungen entspricht."
      },
      {
        "kind": "p",
        "text": "(2) Maßstab bei Growimo. Maßgeblich ist der Anteil der bereits verbrauchten KI-Generierungen am Kontingent des gebuchten Abrechnungszeitraums (Pro: 200 Generierungen pro Monat bzw. 12 × 200 im Jahresplan). Beispiel: Bei einem Monatsabo für 19 € und 40 bereits verbrauchten von 200 Generierungen beträgt der Wertersatz 40/200 × 19 € = 3,80 €; der Rest wird zurückgezahlt. (Rechenbeispiel zur Veranschaulichung, keine Rechtsfolgen-Zusage im Einzelfall.)"
      },
      {
        "kind": "p",
        "text": "(3) Erlöschen des Widerrufsrechts. Das Gesetz unterscheidet zwei Fälle, und beide verlangen dieselbe doppelte Erklärung von dir (ausdrückliches Verlangen und Bestätigung der Kenntnis vom Verlust):"
      },
      {
        "kind": "list",
        "items": [
          "Dienstleistung — § 356 Abs. 5 BGB: Das Widerrufsrecht erlischt, wenn wir die Dienstleistung vollständig erbracht haben, nachdem du ausdrücklich verlangt hast, dass wir vor Ablauf der Widerrufsfrist beginnen, und du bestätigt hast, dass dir bekannt ist, dass du dadurch dein Widerrufsrecht verlierst. Bei einem laufzeitgebundenen Abonnement ist die Leistung erst mit Ablauf des gebuchten Abrechnungszeitraums vollständig erbracht.",
          "Digitale Inhalte — § 356 Abs. 4 BGB: Bei Verträgen über digitale Inhalte, die nicht auf einem körperlichen Datenträger geliefert werden, erlischt das Widerrufsrecht, wenn wir mit der Ausführung begonnen haben, nachdem du ausdrücklich zugestimmt hast und bestätigt hast, dass du dadurch dein Widerrufsrecht verlierst."
        ]
      },
      {
        "kind": "p",
        "text": "Ob ein Growimo-Abo rechtlich als Dienstleistung (Abs. 5) oder als Vertrag über digitale Inhalte (Abs. 4) einzuordnen ist, ist nicht abschließend geklärt; die Praxis behandelt laufzeitgebundene SaaS-Abonnements überwiegend als Dienstleistung. Deshalb wird hier kein automatisches Erlöschen behauptet, sondern die Voraussetzung benannt, unter der es eintritt."
      },
      {
        "kind": "p",
        "text": "(4) Bis zur vollständigen Erbringung bleibt dein Widerrufsrecht bestehen. Übst du es aus, schuldest du für die bis zur Mitteilung des Widerrufs bereits erbrachten Leistungen Wertersatz nach § 357a Abs. 1 BGB (Absatz (1) und (2) oben)."
      },
      {
        "kind": "p",
        "text": "(5) Ohne dein ausdrückliches Verlangen nach (3) beginnen wir nicht vor Ablauf der Widerrufsfrist. Dein Widerrufsrecht besteht dann für die vollen vierzehn Tage, und ein Wertersatz wird nicht geschuldet. Die bloße Nutzung des Dienstes ist kein solches Verlangen und lässt das Widerrufsrecht nicht erlöschen."
      }
    ]
  },
  {
    "id": "hinweis-zum-vorzeitigen-beginn",
    "title": "Hinweis zum vorzeitigen Beginn",
    "blocks": [
      {
        "kind": "p",
        "text": "Wenn du vor Ablauf der Widerrufsfrist ausdrücklich verlangst, dass wir mit der Erbringung der Dienstleistung beginnen, hast du im Fall eines Widerrufs den anteiligen Betrag für die bis dahin erbrachte Leistung zu zahlen (siehe „Beginn der Leistung vor Ablauf der Widerrufsfrist — Konsequenzen\")."
      }
    ]
  },
  {
    "id": "muster-widerrufsformular",
    "title": "Muster-Widerrufsformular",
    "blocks": [
      {
        "kind": "p",
        "text": "(Wenn du den Vertrag widerrufen willst, fülle dieses Formular aus und sende es zurück.)"
      },
      {
        "kind": "p",
        "text": "An:"
      },
      {
        "kind": "p",
        "text": "Katharina Fahr"
      },
      {
        "kind": "p",
        "text": "Hauptstr. 38"
      },
      {
        "kind": "p",
        "text": "23619 Badendorf"
      },
      {
        "kind": "p",
        "text": "Deutschland"
      },
      {
        "kind": "p",
        "text": "E-Mail: kontakt@growimo.app"
      },
      {
        "kind": "p",
        "text": "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "Bestellt am (*) / Vertragsabschluss am (*):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "Name des/der Verbraucher(s):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "Anschrift des/der Verbraucher(s):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "E-Mail-Adresse des/der Verbraucher(s) (für die Rückmeldung):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier):"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "Datum:"
      },
      {
        "kind": "blank"
      },
      {
        "kind": "p",
        "text": "(*) Unzutreffendes streichen."
      }
    ]
  },
  {
    "id": "hinweis-zum-widerruf-bei-kostenpflichtigen-abonnements",
    "title": "Hinweis zum Widerruf bei kostenpflichtigen Abonnements",
    "blocks": [
      {
        "kind": "p",
        "text": "Der Widerruf ist zu unterscheiden von der Kündigung. Für die Beendigung eines laufenden Abonnements genügt die Kündigung zum Ende des laufenden Abrechnungszeitraums (siehe AGB, § 10). Der Widerruf betrifft den Vertragsabschluss selbst und ist nur innerhalb der Widerrufsfrist möglich."
      },
      {
        "kind": "p",
        "text": "Nach einer Kündigung bleibt der Zugang bis zum Ende des bereits bezahlten Abrechnungszeitraums bestehen; das bereits verbrauchte kostenlose Kontingent von 3 Generierungen wird nicht wiederhergestellt (AGB § 10 Abs. 7). Ein Widerruf innerhalb der Widerrufsfrist führt dagegen zur Rückabwicklung des Vertrags nach Maßgabe der „Widerrufsfolgen\"."
      }
    ]
  }
];
