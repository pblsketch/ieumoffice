import type { zh } from './zh'

export const en = {
  homeHelpSection: 'Help',
  homeHelpClose: 'Close',
  homeHelpReplay: 'Show the welcome guide again',
  homeHelpReplayFailed: "Couldn't turn the welcome guide back on. Try again in a moment.",
  homeHelpFeedback: 'Send feedback',
  homeHelpWhatsNew: "What's new in this version",

  homeHelpOpenTitle: 'Opening documents',
  homeHelpOpenBody1:
    'Tap "Open file" on the Recent tab to pick a document on this device or in another storage app.',
  homeHelpOpenBody2:
    'Link a folder you use often, and its documents show up right away on the Folders tab.',
  homeHelpOpenBody3:
    'Documents you open stay on the Recent tab. Star one to find it under Favorites as well.',
  homeHelpOpenBody4: 'A document opens for reading first. When you want to change it, tap [Edit].',

  homeHelpEditTitle: 'Editing and saving',
  homeHelpEditBody1: 'In reading mode, tap [Edit] at the top to start making changes.',
  homeHelpEditBody2:
    'Tap the text to bring up the keyboard. The bar above it has formatting such as bold and lists.',
  homeHelpEditBody3:
    'When you are done, tap [Done]. The original file is saved and you are back in reading mode.',
  homeHelpEditBody4: 'If the original file can\'t be written, use "Save As" to make a new file.',

  homeHelpRecoveryTitle: 'Saving and recovery copies',
  homeHelpRecoveryBody1:
    'While you edit, the app keeps a recovery copy on its own. There is nothing to tap.',
  homeHelpRecoveryBody2: 'The original file is written when you tap [Done].',
  homeHelpRecoveryBody3:
    'If the app closes before you save, a notice about the recovery copy appears at the top of the Recent tab next time. Restore it from there.',
  homeHelpRecoveryBody4:
    'You can see how much space recovery copies take, and clear them, in Settings > Storage.',

  homeHelpShareTitle: 'Sharing and receiving',
  homeHelpShareBody1:
    'While viewing a document, tap [Share] to send the original as it is, or in another format such as PDF.',
  homeHelpShareBody2:
    'In a list on the home screen, choose [⋯] > Share to send the original file. Long-press to pick several files and send them together.',
  homeHelpShareBody3:
    'A file sent from another app opens read-only. To change it, tap [Edit a copy]. The original stays as it was.',

  homeHelpFlowTitle: 'Reading view for HWP',
  homeHelpFlowBody1:
    'HWP documents open in page view as they would print. To reflow text to fit your screen width, tap [Reading view] in the view tools.',
  homeHelpFlowBody2: 'To return to the printed page layout, tap [Page view] in the view tools.',
  homeHelpFlowBody3:
    'Reading view only changes how the document is shown. Its pages and the saved file stay the same.',

  homeHelpAiTitle: 'Turning AI on and off',
  homeHelpAiBody1: 'AI is off at first. While it is off, no AI buttons appear.',
  homeHelpAiBody2:
    "To use it, turn AI on in Settings, then add an API key or choose a free connection under AI Connections. You don't need an account for this app.",
  homeHelpAiBody3:
    'Content goes to the AI service you chose only when you ask the AI for something. Turn AI off again and every AI button disappears.',

  homeHelpFeedbackTitle: 'Send feedback',
  homeHelpFeedbackBody:
    'The survey opens in your browser. The details below are copied to the clipboard so you can paste them into the survey. The app sends nothing itself, and document contents are never included.',
  homeHelpFeedbackDetails: 'Version {version}\nOS {os}\nUI language {language}',
  homeHelpFeedbackOpen: 'Open survey',
  homeHelpFeedbackCancel: 'Cancel',
  homeHelpFeedbackCopyFailed:
    "Couldn't copy to the clipboard. Long-press the text below to copy it, then paste it into the survey.",
  homeHelpFeedbackOpenFailed: "Couldn't open the browser.",

  homeHelpWhatsNewVersion: 'Version {version}',
  homeHelpWhatsNewEmpty: 'There are no notes for this version.',
  homeHelpNew010First: 'The first version of the GenOffice mobile app.',
  homeHelpNew010Edit: 'Open and edit HWP, PDF, Markdown, HTML and spreadsheet documents.',
  homeHelpNew010Read: 'Read EPUB books and PPT presentations.',
  homeHelpNew010PdfTools:
    'PDF tools: organize pages, convert, reduce size and add security, remove annotations.',
  homeHelpNew010Ai: 'An AI helper, off at first, that works with an API key or a free connection.',
  homeHelpNew010Mobile:
    'Sharing and receiving files, reading view for HWP, a welcome guide, storage management, and keeping the screen on while you read.',
} as const satisfies Record<keyof typeof zh, string>
