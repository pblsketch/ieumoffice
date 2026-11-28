import type { zh } from './zh'

export const de = {
  homeHelpSection: 'Hilfe',
  homeHelpClose: 'Schließen',
  homeHelpReplay: 'Einführung noch einmal ansehen',
  homeHelpReplayFailed:
    'Die Einführung ließ sich nicht wieder einschalten. Versuchen Sie es gleich noch einmal.',
  homeHelpFeedback: 'Feedback senden',
  homeHelpWhatsNew: 'Neu in dieser Version',

  homeHelpOpenTitle: 'Dokumente öffnen',
  homeHelpOpenBody1:
    'Tippen Sie im Tab „Zuletzt“ auf „Datei öffnen“, um ein Dokument auf diesem Gerät oder in einer anderen Speicher-App auszuwählen.',
  homeHelpOpenBody2:
    'Verknüpfen Sie einen Ordner, den Sie oft nutzen. Seine Dokumente erscheinen dann direkt im Tab „Ordner“.',
  homeHelpOpenBody3:
    'Geöffnete Dokumente bleiben im Tab „Zuletzt“. Mit einem Stern finden Sie sie auch unter „Favoriten“.',
  homeHelpOpenBody4:
    'Ein Dokument öffnet sich zuerst zum Lesen. Wenn Sie es ändern möchten, tippen Sie auf [Bearbeiten].',

  homeHelpEditTitle: 'Bearbeiten und speichern',
  homeHelpEditBody1:
    'Tippen Sie in der Leseansicht oben auf [Bearbeiten], um mit dem Ändern zu beginnen.',
  homeHelpEditBody2:
    'Tippen Sie auf den Text, um die Tastatur einzublenden. Die Leiste darüber bietet Formatierungen wie Fett und Listen.',
  homeHelpEditBody3:
    'Wenn Sie fertig sind, tippen Sie auf [Fertig]. Die Originaldatei wird gespeichert und Sie sind wieder in der Leseansicht.',
  homeHelpEditBody4:
    'Wenn sich die Originaldatei nicht überschreiben lässt, legen Sie mit „Speichern unter“ eine neue Datei an.',

  homeHelpRecoveryTitle: 'Speichern und Wiederherstellungskopien',
  homeHelpRecoveryBody1:
    'Während Sie bearbeiten, legt die App von selbst eine Wiederherstellungskopie an. Sie müssen dafür nichts antippen.',
  homeHelpRecoveryBody2: 'Die Originaldatei wird gespeichert, wenn Sie auf [Fertig] tippen.',
  homeHelpRecoveryBody3:
    'Schließt sich die App, bevor Sie speichern, erscheint beim nächsten Start oben im Tab „Zuletzt“ ein Hinweis auf die Wiederherstellungskopie. Dort können Sie sie wiederherstellen.',
  homeHelpRecoveryBody4:
    'Unter Einstellungen > Speicher sehen Sie, wie viel Platz die Wiederherstellungskopien belegen, und können sie löschen.',

  homeHelpShareTitle: 'Teilen und empfangen',
  homeHelpShareBody1:
    'Tippen Sie beim Ansehen eines Dokuments auf [Teilen], um das Original unverändert oder in einem anderen Format wie PDF zu senden.',
  homeHelpShareBody2:
    'Wählen Sie in einer Liste auf dem Startbildschirm [⋯] > Teilen, um die Originaldatei zu senden. Mit langem Drücken wählen Sie mehrere Dateien aus und senden sie zusammen.',
  homeHelpShareBody3:
    'Eine Datei, die aus einer anderen App kommt, öffnet sich schreibgeschützt. Zum Ändern tippen Sie auf [Kopie bearbeiten]. Das Original bleibt unverändert.',

  homeHelpFlowTitle: 'Leseansicht für HWP',
  homeHelpFlowBody1:
    'HWP-Dokumente öffnen sich in der Seitenansicht wie gedruckt. Um den Text an die Bildschirmbreite anzupassen, tippen Sie in den Ansichtswerkzeugen auf [Leseansicht].',
  homeHelpFlowBody2:
    'Um zur gedruckten Seitenansicht zurückzukehren, tippen Sie in den Ansichtswerkzeugen auf [Seitenansicht].',
  homeHelpFlowBody3:
    'Die Leseansicht ändert nur die Darstellung. Die Seiten des Dokuments und die gespeicherte Datei bleiben gleich.',

  homeHelpAiTitle: 'KI ein- und ausschalten',
  homeHelpAiBody1:
    'Die KI ist anfangs ausgeschaltet. Solange sie aus ist, erscheinen keine KI-Schaltflächen.',
  homeHelpAiBody2:
    'Um sie zu nutzen, schalten Sie die KI in den Einstellungen ein und fügen unter „KI-Verbindungen“ einen API-Schlüssel hinzu oder wählen eine kostenlose Verbindung. Ein Konto für diese App brauchen Sie nicht.',
  homeHelpAiBody3:
    'Inhalte gehen nur dann an den gewählten KI-Dienst, wenn Sie die KI um etwas bitten. Schalten Sie die KI wieder aus, verschwinden alle KI-Schaltflächen.',

  homeHelpFeedbackTitle: 'Feedback senden',
  homeHelpFeedbackBody:
    'Die Umfrage öffnet sich im Browser. Die Angaben unten werden in die Zwischenablage kopiert, damit Sie sie in die Umfrage einfügen können. Die App selbst sendet nichts, und Dokumentinhalte sind nie enthalten.',
  homeHelpFeedbackDetails: 'Version {version}\nBetriebssystem {os}\nSprache {language}',
  homeHelpFeedbackOpen: 'Umfrage öffnen',
  homeHelpFeedbackCancel: 'Abbrechen',
  homeHelpFeedbackCopyFailed:
    'Kopieren in die Zwischenablage hat nicht geklappt. Drücken Sie lange auf den Text unten, um ihn zu kopieren, und fügen Sie ihn dann in die Umfrage ein.',
  homeHelpFeedbackOpenFailed: 'Der Browser ließ sich nicht öffnen.',

  homeHelpWhatsNewVersion: 'Version {version}',
  homeHelpWhatsNewEmpty: 'Zu dieser Version gibt es keine Hinweise.',
  homeHelpNew010First: 'Die erste Version der GenOffice-App für Mobilgeräte.',
  homeHelpNew010Edit: 'HWP-, PDF-, Markdown-, HTML- und Tabellendokumente öffnen und bearbeiten.',
  homeHelpNew010Read: 'EPUB-Bücher und PPT-Präsentationen lesen.',
  homeHelpNew010PdfTools:
    'PDF-Werkzeuge: Seiten ordnen, umwandeln, verkleinern und schützen, Anmerkungen entfernen.',
  homeHelpNew010Ai:
    'Ein KI-Assistent, anfangs ausgeschaltet, der mit einem API-Schlüssel oder einer kostenlosen Verbindung arbeitet.',
  homeHelpNew010Mobile:
    'Dateien teilen und empfangen, Leseansicht für HWP, Einführung, Speicherverwaltung und Bildschirm bleibt beim Lesen an.',
} as const satisfies Record<keyof typeof zh, string>
