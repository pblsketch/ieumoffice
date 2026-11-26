import type { zh } from './zh'

export const pt = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Carregando a grade…',
  sheetsOpening: 'Abrindo a pasta de trabalho… Arquivos grandes levam um momento.',
  sheetsPasswordTitle: 'Pasta de trabalho protegida por senha',
  sheetsPasswordMessage: 'Digite a senha para abrir esta pasta de trabalho.',
  sheetsPasswordLabel: 'Senha',
  sheetsPasswordWrong: 'A senha está incorreta. Tente novamente.',
  sheetsPasswordOpen: 'Abrir',
  sheetsPasswordCancel: 'Cancelar',
  sheetsEncryptionUnsupported: 'Este tipo de proteção por senha não pode ser aberto.',
  sheetsEncryptionDamaged:
    'Esta pasta de trabalho protegida está danificada e não pode ser aberta.',
  sheetsNoticeMacros: 'As macros são mantidas, mas não são executadas.',
  sheetsNoticeExternalLinks:
    'As células que apontam para outros arquivos mostram os últimos valores salvos.',
  sheetsNoticeMacrosAndLinks:
    'As macros são mantidas, mas não são executadas. As células que apontam para outros arquivos mostram os últimos valores salvos.',
} as const satisfies Record<keyof typeof zh, string>
