import type { zh } from './zh'

export const ja = {
  staleDialogTitle: '更新が必要な項目があります',
  staleDialogBody:
    '文書の編集後に以下の項目が最新の状態になっていません。続行する前に更新しますか？',
  staleActionSave: '保存',
  staleActionPrint: '印刷',
  staleActionPdf: 'PDF 書き出し',
  staleActionSubmission: '提出用コピーを保存',
  staleBtnRefreshAll: 'すべて更新',
  staleBtnContinue: 'このまま続行',
  staleBtnCancel: 'キャンセル',
  staleReasonPagesChanged: 'ページ番号が変更されました',
  staleReasonEntriesChanged: '項目内容が変更されました',
  staleKindTocBody: '目次',
  staleKindTocTable: '表目次',
  staleKindTocFigure: '図目次',
  staleKindTocEquation: '数式目次',
  staleKindIndex: '索引',
  staleKindBibliography: '参考文献',
  staleManualConfirmTitle: '手動での編集が検出されました',
  staleManualConfirmBody:
    '次の項目に手動の編集があるため上書きしませんでした：{items}。上書きして更新しますか？',
  staleManualOverwrite: '上書きして更新',
  staleManualSkip: 'スキップ',
  staleRefreshDone: '{count} 件の項目を更新しました。',
  staleRefreshFailed: '一部の項目を更新できませんでした：{error}',
  submissionMenuLabel: '提出用コピーとして保存…',
  submissionMenuDesc:
    '索引・引用・設定マークを除いたクリーンなコピーを別ファイルとして保存します。',
  submissionSaving: '提出用コピーを作成中…',
  submissionSaved: '提出用コピーを保存しました：{name}',
  submissionSavedTailsLost:
    '提出用コピーを保存しました（{name}）。一部のマスターページやコメントは保持できなかった可能性があります。',
  submissionFailedProtected: 'パスワードで保護された文書は提出用コピーとして保存できません。',
  submissionFailedTracked: '変更履歴を含む文書は提出用コピーとして保存できません。',
  submissionFailedVerify:
    '提出用コピーの検証に失敗したため保存を中止しました（{before} → {after} ページ）。HWPX 形式で再試行してください。',
  submissionFailedExport: '提出用コピーを作成できませんでした：{error}',
  submissionFailedWrite: '提出用コピーを保存できませんでした：{error}',
} satisfies Record<keyof typeof zh, string>
