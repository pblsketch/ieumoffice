import type { zh } from './zh'

export const hi = {
  staleDialogTitle: 'कुछ आइटम अपडेट करने की आवश्यकता है',
  staleDialogBody:
    'हाल के संपादनों के बाद निम्न आइटम पुराने हो सकते हैं। आगे बढ़ने से पहले उन्हें रीफ़्रेश करें?',
  staleActionSave: 'सहेजें',
  staleActionPrint: 'प्रिंट करें',
  staleActionPdf: 'PDF निर्यात करें',
  staleActionSubmission: 'जमा करने की प्रति सहेजें',
  staleBtnRefreshAll: 'सभी रीफ़्रेश करें',
  staleBtnContinue: 'फिर भी आगे बढ़ें',
  staleBtnCancel: 'रद्द करें',
  staleReasonPagesChanged: 'पृष्ठ संख्या बदल गई',
  staleReasonEntriesChanged: 'प्रविष्टियाँ बदल गईं',
  staleKindTocBody: 'विषय-सूची',
  staleKindTocTable: 'तालिकाओं की सूची',
  staleKindTocFigure: 'चित्रों की सूची',
  staleKindTocEquation: 'समीकरणों की सूची',
  staleKindIndex: 'अनुक्रमणिका',
  staleKindBibliography: 'संदर्भ-सूची',
  staleManualConfirmTitle: 'मैन्युअल संपादन मिला',
  staleManualConfirmBody:
    'इनमें मैन्युअल संपादन मिला: {items}। क्या इन्हें ओवरराइट करके रीफ़्रेश करें?',
  staleManualOverwrite: 'ओवरराइट कर रीफ़्रेश करें',
  staleManualSkip: 'छोड़ें',
  staleRefreshDone: '{count} आइटम अपडेट किए गए।',
  staleRefreshFailed: 'कुछ आइटम अपडेट नहीं हो सके: {error}',
  submissionMenuLabel: 'जमा करने की प्रति के रूप में सहेजें…',
  submissionMenuDesc: 'अनुक्रमणिका, उद्धरण और सेटिंग चिह्नों के बिना एक अलग स्वच्छ प्रति सहेजें।',
  submissionSaving: 'जमा करने की प्रति बनाई जा रही है…',
  submissionSaved: 'जमा करने की प्रति सहेजी गई: {name}',
  submissionSavedTailsLost:
    'जमा करने की प्रति सहेजी गई ({name})। कुछ मास्टर पृष्ठ या टिप्पणियाँ सुरक्षित नहीं रह पाईं।',
  submissionFailedProtected:
    'पासवर्ड से सुरक्षित दस्तावेज़ों को जमा करने की प्रति के रूप में नहीं सहेजा जा सकता।',
  submissionFailedTracked:
    'बदलाव ट्रैकिंग वाले दस्तावेज़ों को जमा करने की प्रति के रूप में नहीं सहेजा जा सकता।',
  submissionFailedVerify:
    'जमा करने की प्रति का सत्यापन विफल रहा ({before} → {after} पृष्ठ)। HWPX प्रारूप में सहेजकर देखें।',
  submissionFailedExport: 'जमा करने की प्रति नहीं बन सकी: {error}',
  submissionFailedWrite: 'जमा करने की प्रति सहेजी नहीं जा सकी: {error}',
} satisfies Record<keyof typeof zh, string>
