import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/** 22-language UI strings for 1-click coding-agent guide copy and previewed Diagnostics ZIP export. */
export const DIAGNOSTICS_UI_STRINGS = defineStrings({
  zh: {
    copyAgentGuide: '复制编程代理使用说明',
    copiedAgentGuide: '已复制说明',
    exportDiagnosticsBtn: '导出诊断信息 (.zip)',
    previewTitle: '诊断文件包含内容预览',
    previewNotice:
      '仅包含以下非敏感环境信息。绝不包含文档内容、文件路径、打开的标签页、账号邮箱、API 密钥或原始错误堆栈。',
    saveZipBtn: '保存 .zip',
    cancelBtn: '取消',
    savedNotice: '已保存诊断文件。',
  },
  en: {
    copyAgentGuide: 'Copy guide for coding agents',
    copiedAgentGuide: 'Guide copied',
    exportDiagnosticsBtn: 'Export diagnostics (.zip)',
    previewTitle: 'Preview diagnostics contents',
    previewNotice:
      'Only the non-sensitive items below will be saved. Document contents, file paths, open tabs, emails, API keys, tokens, and raw error text are never included.',
    saveZipBtn: 'Save .zip',
    cancelBtn: 'Cancel',
    savedNotice: 'Diagnostics file saved.',
  },
  ja: {
    copyAgentGuide: 'コーディングエージェント向け案内をコピー',
    copiedAgentGuide: '案内をコピーしました',
    exportDiagnosticsBtn: '診断情報を書き出す (.zip)',
    previewTitle: '診断ファイルに含まれる内容のプレビュー',
    previewNotice:
      '以下の非機密情報のみが保存されます。文書本文、ファイルパス、開いているタブ、メールアドレス、API キー、元のエラー文は一切含まれません。',
    saveZipBtn: '.zip を保存',
    cancelBtn: 'キャンセル',
    savedNotice: '診断ファイルを保存しました。',
  },
  ko: {
    copyAgentGuide: '코딩 에이전트용 안내문 복사',
    copiedAgentGuide: '안내문 복사됨',
    exportDiagnosticsBtn: '진단 정보 내보내기(.zip)',
    previewTitle: '진단 파일 포함 항목 미리보기',
    previewNotice:
      '아래의 비민감 환경 정보만 저장됩니다. 문서 본문, 파일 경로·이름, 열린 탭, 계정 이메일, API 키·토큰, 원문 오류 메시지는 절대 포함되지 않습니다.',
    saveZipBtn: '저장',
    cancelBtn: '취소',
    savedNotice: '진단 파일을 저장했습니다.',
  },
  fr: {
    copyAgentGuide: 'Copier le guide pour agents de code',
    copiedAgentGuide: 'Guide copié',
    exportDiagnosticsBtn: 'Exporter les diagnostics (.zip)',
    previewTitle: 'Aperçu du contenu des diagnostics',
    previewNotice:
      'Seules les informations techniques non sensibles ci-dessous sont enregistrées. Aucun document, chemin, onglet, e-mail ni clé n’est inclus.',
    saveZipBtn: 'Enregistrer .zip',
    cancelBtn: 'Annuler',
    savedNotice: 'Fichier de diagnostics enregistré.',
  },
  de: {
    copyAgentGuide: 'Anleitung für Coding-Agenten kopieren',
    copiedAgentGuide: 'Anleitung kopiert',
    exportDiagnosticsBtn: 'Diagnosedaten exportieren (.zip)',
    previewTitle: 'Vorschau der enthaltenen Diagnosedaten',
    previewNotice:
      'Nur die unten gezeigten unkritischen Daten werden gespeichert. Dokumentinhalte, Dateipfade, offene Tabs, E-Mails und Schlüssel sind ausgeschlossen.',
    saveZipBtn: '.zip speichern',
    cancelBtn: 'Abbrechen',
    savedNotice: 'Diagnosedatei gespeichert.',
  },
  es: {
    copyAgentGuide: 'Copiar guía para agentes de código',
    copiedAgentGuide: 'Guía copiada',
    exportDiagnosticsBtn: 'Exportar diagnósticos (.zip)',
    previewTitle: 'Vista previa de los datos de diagnóstico',
    previewNotice:
      'Solo se guardará la información técnica no sensible mostrada abajo. Nunca se incluyen documentos, rutas, pestañas, correos ni claves.',
    saveZipBtn: 'Guardar .zip',
    cancelBtn: 'Cancelar',
    savedNotice: 'Archivo de diagnóstico guardado.',
  },
  th: {
    copyAgentGuide: 'คัดลอกคู่มือสำหรับเอเจนต์เขียนโค้ด',
    copiedAgentGuide: 'คัดลอกคู่มือแล้ว',
    exportDiagnosticsBtn: 'ส่งออกข้อมูลวินิจฉัย (.zip)',
    previewTitle: 'ตัวอย่างข้อมูลที่จะรวมในไฟล์วินิจฉัย',
    previewNotice:
      'จะบันทึกเฉพาะข้อมูลสภาพแวดล้อมที่ไม่ละเอียดอ่อนด้านล่าง ไม่รวมเนื้อหาเอกสาร พาธไฟล์ แท็บที่เปิด อีเมล หรือคีย์ใดๆ',
    saveZipBtn: 'บันทึก .zip',
    cancelBtn: 'ยกเลิก',
    savedNotice: 'บันทึกไฟล์วินิจฉัยแล้ว',
  },
  id: {
    copyAgentGuide: 'Salin panduan untuk agen kode',
    copiedAgentGuide: 'Panduan disalin',
    exportDiagnosticsBtn: 'Ekspor diagnostik (.zip)',
    previewTitle: 'Pratinjau isi file diagnostik',
    previewNotice:
      'Hanya info teknis non-sensitif di bawah ini yang disimpan. Isi dokumen, jalur file, tab terbuka, email, dan kunci tidak pernah disertakan.',
    saveZipBtn: 'Simpan .zip',
    cancelBtn: 'Batal',
    savedNotice: 'File diagnostik disimpan.',
  },
  ru: {
    copyAgentGuide: 'Копировать памятку для ИИ-агентов',
    copiedAgentGuide: 'Памятка скопирована',
    exportDiagnosticsBtn: 'Экспорт диагностики (.zip)',
    previewTitle: 'Предпросмотр содержимого диагностики',
    previewNotice:
      'Сохраняются только указанные ниже неконфиденциальные сведения. Содержимое документов, пути, вкладки, почта и ключи никогда не включаются.',
    saveZipBtn: 'Сохранить .zip',
    cancelBtn: 'Отмена',
    savedNotice: 'Файл диагностики сохранён.',
  },
  ar: {
    copyAgentGuide: 'نسخ دليل وكلاء البرمجة',
    copiedAgentGuide: 'تم نسخ الدليل',
    exportDiagnosticsBtn: 'تصدير بيانات التشخيص (.zip)',
    previewTitle: 'معاينة محتويات ملف التشخيص',
    previewNotice:
      'تُحفظ فقط المعلومات التقنية غير الحساسة أدناه. لا يتم تضمين محتوى المستندات أو المسارات أو التبويبات أو البريد أو المفاتيح أبداً.',
    saveZipBtn: 'حفظ .zip',
    cancelBtn: 'إلغاء',
    savedNotice: 'تم حفظ ملف التشخيص.',
  },
  pt: {
    copyAgentGuide: 'Copiar guia para agentes de código',
    copiedAgentGuide: 'Guia copiado',
    exportDiagnosticsBtn: 'Exportar diagnósticos (.zip)',
    previewTitle: 'Prévia dos dados de diagnóstico',
    previewNotice:
      'Apenas as informações técnicas não sensíveis abaixo serão salvas. Documentos, caminhos, abas, e-mails e chaves nunca são incluídos.',
    saveZipBtn: 'Salvar .zip',
    cancelBtn: 'Cancelar',
    savedNotice: 'Arquivo de diagnóstico salvo.',
  },
  it: {
    copyAgentGuide: 'Copia guida per agenti di codice',
    copiedAgentGuide: 'Guida copiata',
    exportDiagnosticsBtn: 'Esporta diagnostica (.zip)',
    previewTitle: 'Anteprima dei contenuti diagnostici',
    previewNotice:
      'Verranno salvati solo i dati tecnici non sensibili elencati sotto. Contenuti dei documenti, percorsi, schede, email e chiavi non sono mai inclusi.',
    saveZipBtn: 'Salva .zip',
    cancelBtn: 'Annulla',
    savedNotice: 'File di diagnostica salvato.',
  },
  pl: {
    copyAgentGuide: 'Kopiuj przewodnik dla agentów kodu',
    copiedAgentGuide: 'Skopiowano przewodnik',
    exportDiagnosticsBtn: 'Eksportuj diagnostykę (.zip)',
    previewTitle: 'Podgląd zawartości pliku diagnostycznego',
    previewNotice:
      'Zapisane zostaną tylko poniższe dane techniczne. Treść dokumentów, ścieżki, karty, adresy e-mail i klucze nigdy nie są dołączane.',
    saveZipBtn: 'Zapisz .zip',
    cancelBtn: 'Anuluj',
    savedNotice: 'Zapisano plik diagnostyczny.',
  },
  cs: {
    copyAgentGuide: 'Kopírovat návod pro kódovací agenty',
    copiedAgentGuide: 'Návod zkopírován',
    exportDiagnosticsBtn: 'Exportovat diagnostiku (.zip)',
    previewTitle: 'Náhled obsahu diagnostického souboru',
    previewNotice:
      'Uloží se pouze níže uvedené necitlivé technické údaje. Obsah dokumentů, cesty, karty, e-maily ani klíče nejsou nikdy zahrnuty.',
    saveZipBtn: 'Uložit .zip',
    cancelBtn: 'Zrušit',
    savedNotice: 'Diagnostický soubor byl uložen.',
  },
  nl: {
    copyAgentGuide: 'Handleiding voor code-agenten kopiëren',
    copiedAgentGuide: 'Handleiding gekopieerd',
    exportDiagnosticsBtn: 'Diagnostiek exporteren (.zip)',
    previewTitle: 'Voorbeeld van diagnostische inhoud',
    previewNotice:
      'Alleen de onderstaande niet-gevoelige gegevens worden opgeslagen. Documentinhoud, paden, tabbladen, e-mails en sleutels worden nooit opgenomen.',
    saveZipBtn: '.zip opslaan',
    cancelBtn: 'Annuleren',
    savedNotice: 'Diagnostisch bestand opgeslagen.',
  },
  ms: {
    copyAgentGuide: 'Salin panduan untuk ejen pengekodan',
    copiedAgentGuide: 'Panduan disalin',
    exportDiagnosticsBtn: 'Eksport diagnostik (.zip)',
    previewTitle: 'Pratonton kandungan fail diagnostik',
    previewNotice:
      'Hanya maklumat teknikal bukan sensitif di bawah disimpan. Kandungan dokumen, laluan fail, tab terbuka, e-mel dan kunci tidak pernah disertakan.',
    saveZipBtn: 'Simpan .zip',
    cancelBtn: 'Batal',
    savedNotice: 'Fail diagnostik disimpan.',
  },
  he: {
    copyAgentGuide: 'העתק מדריך לסוכני קוד',
    copiedAgentGuide: 'המדריך הועתק',
    exportDiagnosticsBtn: 'ייצא אבחון (.zip)',
    previewTitle: 'תצוגה מקדימה של תוכן האבחון',
    previewNotice:
      'רק המידע הטכני הלא-רגיש שלהלן יישמר. תוכן מסמכים, נתיבים, כרטיסיות, כתובות אימייל ומפתחות לעולם אינם נכללים.',
    saveZipBtn: 'שמור .zip',
    cancelBtn: 'ביטול',
    savedNotice: 'קובץ האבחון נשמר.',
  },
  hi: {
    copyAgentGuide: 'कोडिंग एजेंट गाइड कॉपी करें',
    copiedAgentGuide: 'गाइड कॉपी हो गई',
    exportDiagnosticsBtn: 'निदान जानकारी निर्यात करें (.zip)',
    previewTitle: 'निदान फ़ाइल सामग्री का पूर्वावलोकन',
    previewNotice:
      'केवल नीचे दी गई गैर-संवेदनशील तकनीकी जानकारी सहेजी जाएगी। दस्तावेज़ सामग्री, फ़ाइल पथ, खुले टैब, ईमेल या कुंजियाँ कभी शामिल नहीं होतीं।',
    saveZipBtn: '.zip सहेजें',
    cancelBtn: 'रद्द करें',
    savedNotice: 'निदान फ़ाइल सहेजी गई।',
  },
  'zh-TW': {
    copyAgentGuide: '複製程式設計代理說明',
    copiedAgentGuide: '已複製說明',
    exportDiagnosticsBtn: '匯出診斷資訊 (.zip)',
    previewTitle: '診斷檔案包含內容預覽',
    previewNotice:
      '僅包含以下非敏感環境資訊。絕不包含文件內容、檔案路徑、開啟的分頁、帳號信箱、API 金鑰或原始錯誤堆疊。',
    saveZipBtn: '儲存 .zip',
    cancelBtn: '取消',
    savedNotice: '已儲存診斷檔案。',
  },
  vi: {
    copyAgentGuide: 'Sao chép hướng dẫn cho tác nhân lập trình',
    copiedAgentGuide: 'Đã sao chép hướng dẫn',
    exportDiagnosticsBtn: 'Xuất thông tin chẩn đoán (.zip)',
    previewTitle: 'Xem trước nội dung tệp chẩn đoán',
    previewNotice:
      'Chỉ lưu các thông tin kỹ thuật không nhạy cảm bên dưới. Nội dung tài liệu, đường dẫn tệp, thẻ đang mở, email và khóa API không bao giờ được đưa vào.',
    saveZipBtn: 'Lưu .zip',
    cancelBtn: 'Hủy',
    savedNotice: 'Đã lưu tệp chẩn đoán.',
  },
  tr: {
    copyAgentGuide: 'Kodlama ajanları için kılavuzu kopyala',
    copiedAgentGuide: 'Kılavuz kopyalandı',
    exportDiagnosticsBtn: 'Tanılama bilgilerini dışa aktar (.zip)',
    previewTitle: 'Tanılama dosyası içerik önizlemesi',
    previewNotice:
      'Yalnızca aşağıdaki hassas olmayan teknik bilgiler kaydedilir. Belge içeriği, dosya yolları, açık sekmeler, e-postalar ve anahtarlar asla eklenmez.',
    saveZipBtn: '.zip kaydet',
    cancelBtn: 'İptal',
    savedNotice: 'Tanılama dosyası kaydedildi.',
  },
})

export type DiagnosticsUiStringKey = keyof typeof DIAGNOSTICS_UI_STRINGS.zh

export const diagnosticsUiText: (
  lang: Lang,
  key: DiagnosticsUiStringKey,
  params?: Params,
) => string = createI18n(DIAGNOSTICS_UI_STRINGS)
