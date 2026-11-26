import type { zh } from './zh'

export const es = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Cargando la cuadrícula…',
  sheetsOpening: 'Abriendo el libro… Los archivos grandes tardan un poco.',
  sheetsPasswordTitle: 'Libro protegido con contraseña',
  sheetsPasswordMessage: 'Introduce la contraseña para abrir este libro.',
  sheetsPasswordLabel: 'Contraseña',
  sheetsPasswordWrong: 'La contraseña no es correcta. Inténtalo de nuevo.',
  sheetsPasswordOpen: 'Abrir',
  sheetsPasswordCancel: 'Cancelar',
  sheetsEncryptionUnsupported: 'No se puede abrir este tipo de protección con contraseña.',
  sheetsEncryptionDamaged: 'Este libro protegido está dañado y no se puede abrir.',
  sheetsNoticeMacros: 'Las macros se conservan, pero no se ejecutan.',
  sheetsNoticeExternalLinks:
    'Las celdas que apuntan a otros archivos muestran su último valor guardado.',
  sheetsNoticeMacrosAndLinks:
    'Las macros se conservan, pero no se ejecutan. Las celdas que apuntan a otros archivos muestran su último valor guardado.',
} as const satisfies Record<keyof typeof zh, string>
