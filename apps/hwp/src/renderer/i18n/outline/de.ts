import type { zh } from './zh'

export const de = {
  outlineLevelFilterLabel: 'Überschriftenebenen-Filter',
  outlineLevelAll: 'Alle',
  outlineLevelItem: 'Bis Ebene {level} anzeigen',
  outlinePromote: 'Höher stufen',
  outlinePromoteTooltip:
    'Überschrift und Unterüberschriften höher stufen (Umschalt+Klick: nur diese Überschrift)',
  outlineDemote: 'Tiefer stufen',
  outlineDemoteTooltip:
    'Überschrift und Unterüberschriften tiefer stufen (Umschalt+Klick: nur diese Überschrift)',
  outlineSettingsToggle: 'Ebenenzuordnung',
  outlineSettingsTitle: 'Gliederungsebenen zuordnen',
  outlineTreeLabel: 'Dokumentgliederung',
  outlineLoading: 'Gliederung wird gelesen…',
  outlineEmpty:
    'Keine Überschriften gefunden. Verwenden Sie Gliederungsnummern oder ordnen Sie Absatzformate unter Ebenenzuordnung zu.',
  outlineFilteredEmpty: 'Keine Überschriften für die gewählte Ebene gefunden.',
  outlineExpand: 'Unterüberschriften ausklappen',
  outlineCollapse: 'Unterüberschriften einklappen',
  outlineUntitled: '(Ohne Titel)',
  outlinePageAria: 'Seite {page}',
  outlineMenuPromote: 'Höher stufen (mit Unterüberschriften)',
  outlineMenuDemote: 'Tiefer stufen (mit Unterüberschriften)',
  outlineMenuPromoteSingle: 'Nur diese Überschrift höher stufen',
  outlineMenuDemoteSingle: 'Nur diese Überschrift tiefer stufen',
  outlineMenuExpand: 'Unterüberschriften ausklappen',
  outlineMenuCollapse: 'Unterüberschriften einklappen',
  outlineScopeLabel: 'Geltungsbereich',
  outlineScopeDoc: 'Nur dieses Dokument',
  outlineScopeApp: 'App-weit',
  outlineScopeDocActive: 'Für dieses Dokument ist eine eigene Zuordnung aktiv.',
  outlineScopeAppActive: 'Die App-weite Ebenenzuordnung wird verwendet.',
  outlineMappingEmpty:
    'Keine Formate zugeordnet. Native Gliederungsabsätze werden weiterhin angezeigt.',
  outlineStyleSelectLabel: 'Absatzformat',
  outlineStyleInputPlaceholder: 'Format auswählen oder eingeben…',
  outlineLevelSelectLabel: 'Gliederungsebene',
  outlineLevelOption: 'Ebene {level}',
  outlineMappingAdd: 'Hinzufügen',
  outlineMappingRemove: 'Zuordnung für {style} entfernen',
  outlineClearDocOverride: 'App-weite Zuordnung verwenden',
  outlineResetAppDefaults: 'Standard wiederherstellen',
  outlineSettingsClose: 'Schließen',
  outlineSettingsSavedDoc: 'Ebenenzuordnung für dieses Dokument gespeichert.',
  outlineSettingsSavedApp: 'App-weite Ebenenzuordnung gespeichert.',
  outlineSettingsClearedDoc: 'Auf App-weite Ebenenzuordnung zurückgesetzt.',
  outlineSettingsResetApp: 'Standard-Ebenenzuordnung wiederhergestellt.',
  outlineSettingsSaveFailed: 'Ebenenzuordnung konnte nicht gespeichert werden: {error}',
  outlineReadFailed: 'Gliederung konnte nicht gelesen werden: {error}',
  outlineDismissNotice: 'Hinweis schließen',
  outlineOpUnavailable: 'Diese Gliederungsbearbeitung ist noch nicht verfügbar.',
  outlineLevelNotFound: 'Die ausgewählte Überschrift wurde nicht gefunden.',
  outlineLevelUnsupported:
    'Die Ebene dieser Überschrift kann an dieser Stelle nicht geändert werden.',
  outlineLevelOutOfRange: 'Die Überschriftenebene muss zwischen 1 und 10 liegen.',
  outlineLevelNoMappedStyle:
    'Der Ebene {level} ist kein Format zugeordnet. Legen Sie eines unter Ebenenzuordnung fest.',
  outlineLevelMissingStyle: 'Das Format „{style}“ existiert in diesem Dokument nicht.',
  outlineLevelFailed: 'Überschriftenebene konnte nicht geändert werden: {error}',
  outlineMoveNotFound: 'Quell- oder Zielüberschrift wurde nicht gefunden.',
  outlineMoveUnsupported: 'Dieser Abschnitt kann nicht verschoben werden.',
  outlineMoveCrossSection:
    'Abschnitte können nicht über verschiedene Dokumentabschnitte hinweg verschoben werden.',
  outlineMoveFirstParaLayout:
    'Verschieben über den ersten Absatz mit Abschnittslayout-Einstellungen ist nicht möglich.',
  outlineMoveTargetInsideSource:
    'Eine Überschrift kann nicht in ihren eigenen Unterabschnitt verschoben werden.',
  outlineMoveNoChange: 'Der Abschnitt befindet sich bereits an dieser Position.',
  outlineMoveObjectsChanged:
    'Verschieben abgebrochen, um Tabellen, Bilder oder andere Objekte im Abschnitt zu schützen.',
  outlineMoveBookmarksLost:
    'Verschieben abgebrochen, um Textmarken oder Verweise im Abschnitt zu schützen.',
  outlineMoveEngineError: 'Abschnitt konnte nicht verschoben werden: {error}',
} satisfies Record<keyof typeof zh, string>
