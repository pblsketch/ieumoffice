/**
 * 22-language UI strings for Slides & HWP compatible review-memo reply threads (T10).
 */
import type { Lang } from '@genoffice/i18n'

export type MemoReplyStringKey =
  'reply' | 'replyPlaceholder' | 'sendReply' | 'cancelReply' | 'readOnlyNoReply'

type Dict = Record<MemoReplyStringKey, string>

const EN: Dict = {
  reply: 'Reply',
  replyPlaceholder: 'Write a reply…',
  sendReply: 'Post reply',
  cancelReply: 'Cancel',
  readOnlyNoReply: 'Read-only memo — replies cannot be saved to this memo.',
}

const STRINGS: Record<Lang, Dict> = {
  zh: {
    reply: '回复',
    replyPlaceholder: '输入回复…',
    sendReply: '添加回复',
    cancelReply: '取消',
    readOnlyNoReply: '只读批注 — 无法在此批注中保存回复。',
  },
  en: EN,
  ja: {
    reply: '返信',
    replyPlaceholder: '返信を入力…',
    sendReply: '返信を保存',
    cancelReply: 'キャンセル',
    readOnlyNoReply: '読み取り専用メモ — このメモには返信を保存できません。',
  },
  ko: {
    reply: '답글',
    replyPlaceholder: '답글 입력…',
    sendReply: '답글 달기',
    cancelReply: '취소',
    readOnlyNoReply: '읽기 전용 메모 — 이 메모에는 답글을 저장할 수 없습니다.',
  },
  fr: {
    reply: 'Répondre',
    replyPlaceholder: 'Écrire une réponse…',
    sendReply: 'Publier',
    cancelReply: 'Annuler',
    readOnlyNoReply: 'Note en lecture seule — impossible d’enregistrer une réponse.',
  },
  de: {
    reply: 'Antworten',
    replyPlaceholder: 'Antwort schreiben…',
    sendReply: 'Antwort senden',
    cancelReply: 'Abbrechen',
    readOnlyNoReply: 'Schreibgeschützte Notiz — Antworten können nicht gespeichert werden.',
  },
  es: {
    reply: 'Responder',
    replyPlaceholder: 'Escribe una respuesta…',
    sendReply: 'Publicar respuesta',
    cancelReply: 'Cancelar',
    readOnlyNoReply: 'Nota de solo lectura — no se puede guardar respuesta.',
  },
  th: {
    reply: 'ตอบกลับ',
    replyPlaceholder: 'พิมพ์คำตอบ…',
    sendReply: 'บันทึกคำตอบ',
    cancelReply: 'ยกเลิก',
    readOnlyNoReply: 'บันทึกอ่านอย่างเดียว — ไม่สามารถบันทึกคำตอบได้',
  },
  id: {
    reply: 'Balas',
    replyPlaceholder: 'Tulis balasan…',
    sendReply: 'Kirim balasan',
    cancelReply: 'Batal',
    readOnlyNoReply: 'Memo hanya-baca — balasan tidak dapat disimpan.',
  },
  ru: {
    reply: 'Ответить',
    replyPlaceholder: 'Напишите ответ…',
    sendReply: 'Добавить ответ',
    cancelReply: 'Отмена',
    readOnlyNoReply: 'Заметка только для чтения — ответ сохранить нельзя.',
  },
  ar: {
    reply: 'رد',
    replyPlaceholder: 'اكتب ردًا…',
    sendReply: 'إضافة رد',
    cancelReply: 'إلغاء',
    readOnlyNoReply: 'ملاحظة للقراءة فقط — لا يمكن حفظ رد عليها.',
  },
  pt: {
    reply: 'Responder',
    replyPlaceholder: 'Escreva uma resposta…',
    sendReply: 'Enviar resposta',
    cancelReply: 'Cancelar',
    readOnlyNoReply: 'Nota somente leitura — não é possível salvar resposta.',
  },
  it: {
    reply: 'Rispondi',
    replyPlaceholder: 'Scrivi una risposta…',
    sendReply: 'Invia risposta',
    cancelReply: 'Annulla',
    readOnlyNoReply: 'Nota di sola lettura — impossibile salvare risposte.',
  },
  pl: {
    reply: 'Odpowiedz',
    replyPlaceholder: 'Napisz odpowiedź…',
    sendReply: 'Dodaj odpowiedź',
    cancelReply: 'Anuluj',
    readOnlyNoReply: 'Notatka tylko do odczytu — nie można zapisać odpowiedzi.',
  },
  cs: {
    reply: 'Odpovědět',
    replyPlaceholder: 'Napište odpověď…',
    sendReply: 'Uložit odpověď',
    cancelReply: 'Zrušit',
    readOnlyNoReply: 'Poznámka jen pro čtení — odpověď nelze uložit.',
  },
  nl: {
    reply: 'Beantwoorden',
    replyPlaceholder: 'Schrijf een antwoord…',
    sendReply: 'Antwoord plaatsen',
    cancelReply: 'Annuleren',
    readOnlyNoReply: 'Alleen-lezen notitie — antwoorden kunnen niet worden opgeslagen.',
  },
  ms: {
    reply: 'Balas',
    replyPlaceholder: 'Tulis balasan…',
    sendReply: 'Hantar balasan',
    cancelReply: 'Batal',
    readOnlyNoReply: 'Memo baca sahaja — balasan tidak boleh disimpan.',
  },
  he: {
    reply: 'השב',
    replyPlaceholder: 'כתוב תגובה…',
    sendReply: 'שמור תגובה',
    cancelReply: 'ביטול',
    readOnlyNoReply: 'הערה לקריאה בלבד — לא ניתן לשמור תגובה.',
  },
  hi: {
    reply: 'उत्तर दें',
    replyPlaceholder: 'उत्तर लिखें…',
    sendReply: 'उत्तर जोड़ें',
    cancelReply: 'रद्द करें',
    readOnlyNoReply: 'केवल-पढ़ने योग्य मेमो — इस पर उत्तर सहेजा नहीं जा सकता।',
  },
  'zh-TW': {
    reply: '回覆',
    replyPlaceholder: '輸入回覆…',
    sendReply: '新增回覆',
    cancelReply: '取消',
    readOnlyNoReply: '唯讀備註 — 無法在此備註儲存回覆。',
  },
  vi: {
    reply: 'Trả lời',
    replyPlaceholder: 'Nhập nội dung trả lời…',
    sendReply: 'Lưu trả lời',
    cancelReply: 'Hủy',
    readOnlyNoReply: 'Ghi chú chỉ đọc — không thể lưu câu trả lời.',
  },
  tr: {
    reply: 'Yanıtla',
    replyPlaceholder: 'Yanıt yazın…',
    sendReply: 'Yanıt ekle',
    cancelReply: 'İptal',
    readOnlyNoReply: 'Salt okunur not — bu nota yanıt kaydedilemez.',
  },
}

export function memoReplyText(lang: Lang, key: MemoReplyStringKey): string {
  return (STRINGS[lang] ?? EN)[key]
}
