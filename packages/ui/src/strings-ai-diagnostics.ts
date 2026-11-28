import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/**
 * Shared 22-language wording for slow AI wait hints (15s+) and granular
 * transport recovery errors (proxy, TLS certificate, network unreachable, timeout).
 * Never interpolates raw error strings, paths, credentials, or account emails.
 */
export const AI_DIAGNOSTICS_STRINGS = defineStrings({
  zh: {
    slowResponseHint: '响应比平时更久，请稍候片刻，也可以随时停止。',
    errProxyError: '代理连接失败。请检查网络代理设置或企业 VPN 后重试。',
    errCertError: '安全证书验证失败。请检查系统时间、企业根证书或代理设置后重试。',
    errNetworkUnreachable: '无法连接到 AI 服务器。请检查网络连接、DNS 或防火墙设置后重试。',
    errTimeout: 'AI 响应超时。请稍后重试，或缩小请求范围后再试。',
  },
  en: {
    slowResponseHint:
      'This is taking longer than usual. You can keep waiting or stop the request at any time.',
    errProxyError:
      'Could not connect through the proxy. Check your proxy settings or VPN and try again.',
    errCertError:
      'Security certificate verification failed. Check your system clock, corporate certificate, or proxy settings and try again.',
    errNetworkUnreachable:
      'Could not reach the AI server. Check your internet connection, DNS, or firewall and try again.',
    errTimeout:
      'The AI response timed out. Try again shortly, or break the request into a smaller step.',
  },
  ja: {
    slowResponseHint: '通常より時間がかかっています。もう少し待つか、いつでも停止できます。',
    errProxyError:
      'プロキシ経由で接続できませんでした。プロキシ設定や VPN を確認して再試行してください。',
    errCertError:
      'セキュリティ証明書の検証に失敗しました。システム時刻や社内証明書、プロキシ設定を確認してください。',
    errNetworkUnreachable:
      'AI サーバーに接続できません。ネットワーク、DNS、ファイアウォール設定を確認してください。',
    errTimeout:
      'AI の応答がタイムアウトしました。しばらくしてから再試行するか、依頼を小さく分けてお試しください。',
  },
  ko: {
    slowResponseHint:
      '응답이 평소보다 오래 걸리고 있습니다. 잠시 더 기다리거나 중지할 수 있습니다.',
    errProxyError:
      '프록시 연결에 실패했습니다. 네트워크 프록시 설정이나 VPN 상태를 확인한 뒤 다시 시도하세요.',
    errCertError:
      '보안 인증서 확인에 실패했습니다. 시스템 시각, 사내 인증서 또는 프록시 설정을 확인한 뒤 다시 시도하세요.',
    errNetworkUnreachable:
      'AI 서버에 연결할 수 없습니다. 인터넷 연결, DNS 또는 방화벽 설정을 확인한 뒤 다시 시도하세요.',
    errTimeout: '응답 대기 시간이 초과되었습니다. 잠시 후 다시 시도하거나 요청을 나누어 보내세요.',
  },
  fr: {
    slowResponseHint:
      'La réponse prend plus de temps que prévu. Vous pouvez patienter ou arrêter la requête à tout moment.',
    errProxyError:
      'Échec de la connexion via le proxy. Vérifiez vos paramètres proxy ou VPN puis réessayez.',
    errCertError:
      'Échec de la vérification du certificat de sécurité. Vérifiez l’heure système, le certificat d’entreprise ou le proxy.',
    errNetworkUnreachable:
      'Impossible de joindre le serveur IA. Vérifiez votre connexion Internet, le DNS ou le pare-feu.',
    errTimeout:
      'Le délai de réponse de l’IA a expiré. Réessayez dans un instant ou réduisez la portée de la demande.',
  },
  de: {
    slowResponseHint:
      'Die Antwort dauert länger als üblich. Sie können weiter warten oder die Anfrage jederzeit stoppen.',
    errProxyError:
      'Verbindung über den Proxy fehlgeschlagen. Prüfen Sie Ihre Proxy- oder VPN-Einstellungen und versuchen Sie es erneut.',
    errCertError:
      'Überprüfung des Sicherheitszertifikats fehlgeschlagen. Prüfen Sie Systemzeit, Firmenzertifikat oder Proxy-Einstellungen.',
    errNetworkUnreachable:
      'Der KI-Server ist nicht erreichbar. Prüfen Sie Internetverbindung, DNS oder Firewall und versuchen Sie es erneut.',
    errTimeout:
      'Zeitüberschreitung bei der KI-Antwort. Versuchen Sie es kurz darauf erneut oder teilen Sie die Anfrage auf.',
  },
  es: {
    slowResponseHint:
      'Esto está tardando más de lo habitual. Puedes seguir esperando o detener la solicitud en cualquier momento.',
    errProxyError:
      'No se pudo conectar mediante el proxy. Revisa la configuración de proxy o VPN e inténtalo de nuevo.',
    errCertError:
      'Error al verificar el certificado de seguridad. Revisa la hora del sistema, el certificado corporativo o el proxy.',
    errNetworkUnreachable:
      'No se puede acceder al servidor de IA. Revisa tu conexión a Internet, DNS o cortafuegos e inténtalo de nuevo.',
    errTimeout:
      'Se agotó el tiempo de espera de la respuesta de IA. Vuelve a intentarlo en breve o divide la solicitud.',
  },
  th: {
    slowResponseHint: 'การตอบกลับใช้เวลานานกว่าปกติ คุณสามารถรอต่อหรือหยุดคำขอได้ทุกเมื่อ',
    errProxyError: 'เชื่อมต่อผ่านพร็อกซีไม่สำเร็จ โปรดตรวจสอบการตั้งค่าพร็อกซีหรือ VPN แล้วลองใหม่',
    errCertError:
      'ตรวจสอบใบรับรองความปลอดภัยไม่สำเร็จ โปรดตรวจสอบเวลาเครื่อง ใบรับรององค์กร หรือพร็อกซี',
    errNetworkUnreachable:
      'ไม่สามารถเข้าถึงเซิร์ฟเวอร์ AI ได้ โปรดตรวจสอบอินเทอร์เน็ต DNS หรือไฟร์วอลล์',
    errTimeout: 'หมดเวลารอการตอบกลับจาก AI โปรดลองอีกครั้งหรือแบ่งคำขอให้เล็กลง',
  },
  id: {
    slowResponseHint:
      'Respons memakan waktu lebih lama dari biasanya. Anda dapat terus menunggu atau menghentikan permintaan kapan saja.',
    errProxyError:
      'Gagal terhubung melalui proksi. Periksa pengaturan proksi atau VPN Anda lalu coba lagi.',
    errCertError:
      'Verifikasi sertifikat keamanan gagal. Periksa jam sistem, sertifikat perusahaan, atau pengaturan proksi.',
    errNetworkUnreachable:
      'Tidak dapat menjangkau server AI. Periksa koneksi internet, DNS, atau firewall Anda lalu coba lagi.',
    errTimeout:
      'Waktu tunggu respons AI habis. Coba lagi sebentar lagi atau bagi permintaan menjadi bagian lebih kecil.',
  },
  ru: {
    slowResponseHint:
      'Ответ занимает больше времени, чем обычно. Вы можете подождать или остановить запрос в любой момент.',
    errProxyError:
      'Не удалось подключиться через прокси. Проверьте настройки прокси или VPN и повторите попытку.',
    errCertError:
      'Ошибка проверки сертификата безопасности. Проверьте системное время, корпоративный сертификат или прокси.',
    errNetworkUnreachable:
      'Не удалось связаться с сервером ИИ. Проверьте подключение к интернету, DNS или брандмауэр.',
    errTimeout:
      'Превышено время ожидания ответа ИИ. Повторите попытку позже или разбейте запрос на меньшие части.',
  },
  ar: {
    slowResponseHint:
      'يستغرق الرد وقتاً أطول من المعتاد. يمكنك الاستمرار في الانتظار أو إيقاف الطلب في أي وقت.',
    errProxyError:
      'تعذّر الاتصال عبر الوكيل (Proxy). تحقق من إعدادات الوكيل أو VPN وحاول مرة أخرى.',
    errCertError:
      'فشل التحقق من شهادة الأمان. تحقق من وقت النظام أو شهادة المؤسسة أو إعدادات الوكيل.',
    errNetworkUnreachable:
      'تعذّر الوصول إلى خادم الذكاء الاصطناعي. تحقق من اتصال الإنترنت أو DNS أو جدار الحماية.',
    errTimeout:
      'انتهت مهلة انتظار رد الذكاء الاصطناعي. حاول مجدداً بعد قليل أو قسّم الطلب إلى خطوة أصغر.',
  },
  pt: {
    slowResponseHint:
      'Isso está demorando mais que o normal. Você pode continuar aguardando ou interromper a solicitação a qualquer momento.',
    errProxyError:
      'Não foi possível conectar pelo proxy. Verifique as configurações de proxy ou VPN e tente novamente.',
    errCertError:
      'Falha na verificação do certificado de segurança. Verifique o relógio do sistema, o certificado corporativo ou o proxy.',
    errNetworkUnreachable:
      'Não foi possível alcançar o servidor de IA. Verifique sua conexão com a internet, DNS ou firewall.',
    errTimeout:
      'O tempo limite da resposta da IA foi atingido. Tente novamente em instantes ou divida a solicitação.',
  },
  it: {
    slowResponseHint:
      'La risposta sta impiegando più tempo del solito. Puoi attendere ancora o interrompere la richiesta in qualsiasi momento.',
    errProxyError:
      'Impossibile connettersi tramite proxy. Controlla le impostazioni proxy o VPN e riprova.',
    errCertError:
      'Verifica del certificato di sicurezza non riuscita. Controlla l’orologio di sistema, il certificato aziendale o il proxy.',
    errNetworkUnreachable:
      'Impossibile raggiungere il server IA. Controlla la connessione Internet, il DNS o il firewall.',
    errTimeout:
      'Tempo di attesa della risposta IA scaduto. Riprova tra poco o suddividi la richiesta.',
  },
  pl: {
    slowResponseHint:
      'Odpowiedź trwa dłużej niż zwykle. Możesz poczekać jeszcze chwilę lub zatrzymać żądanie w dowolnym momencie.',
    errProxyError:
      'Nie udało się połączyć przez serwer proxy. Sprawdź ustawienia proxy lub VPN i spróbuj ponownie.',
    errCertError:
      'Weryfikacja certyfikatu bezpieczeństwa nie powiodła się. Sprawdź zegar systemowy, certyfikat firmowy lub proxy.',
    errNetworkUnreachable:
      'Nie można połączyć się z serwerem AI. Sprawdź połączenie z internetem, DNS lub zaporę sieciową.',
    errTimeout:
      'Upłynął limit czasu oczekiwania na odpowiedź AI. Spróbuj ponownie za chwilę lub podziel prośbę na mniejsze kroki.',
  },
  cs: {
    slowResponseHint:
      'Odpověď trvá déle než obvykle. Můžete ještě počkat, nebo požadavek kdykoli zastavit.',
    errProxyError:
      'Připojení přes proxy se nezdařilo. Zkontrolujte nastavení proxy nebo VPN a zkuste to znovu.',
    errCertError:
      'Ověření bezpečnostního certifikátu selhalo. Zkontrolujte systémový čas, firemní certifikát nebo nastavení proxy.',
    errNetworkUnreachable:
      'Server AI není dostupný. Zkontrolujte připojení k internetu, DNS nebo bránu firewall.',
    errTimeout:
      'Vypršel časový limit odpovědi AI. Zkuste to za chvíli znovu nebo rozdělte požadavek na menší části.',
  },
  nl: {
    slowResponseHint:
      'Dit duurt langer dan gebruikelijk. U kunt blijven wachten of het verzoek op elk moment stoppen.',
    errProxyError:
      'Verbinding via proxy mislukt. Controleer uw proxy- of VPN-instellingen en probeer het opnieuw.',
    errCertError:
      'Verificatie van het beveiligingscertificaat is mislukt. Controleer systeemtijd, bedrijfscertificaat of proxy-instellingen.',
    errNetworkUnreachable:
      'Kan de AI-server niet bereiken. Controleer uw internetverbinding, DNS of firewall en probeer het opnieuw.',
    errTimeout:
      'Time-out bij het wachten op het AI-antwoord. Probeer het zo opnieuw of splits het verzoek op.',
  },
  ms: {
    slowResponseHint:
      'Ini mengambil masa lebih lama daripada biasa. Anda boleh terus menunggu atau menghentikan permintaan bila-bila masa.',
    errProxyError:
      'Gagal menyambung melalui proksi. Semak tetapan proksi atau VPN anda dan cuba lagi.',
    errCertError:
      'Pengesahan sijil keselamatan gagal. Semak masa sistem, sijil korporat atau tetapan proksi anda.',
    errNetworkUnreachable:
      'Tidak dapat mencapai pelayan AI. Semak sambungan internet, DNS atau tembok api anda dan cuba lagi.',
    errTimeout:
      'Masa menunggu respons AI tamat. Cuba lagi sebentar lagi atau pecahkan permintaan kepada langkah lebih kecil.',
  },
  he: {
    slowResponseHint: 'התגובה נמשכת זמן רב מהרגיל. ניתן להמתין עוד או לעצור את הבקשה בכל עת.',
    errProxyError: 'החיבור דרך שרת הפרוקסי נכשל. בדוק את הגדרות הפרוקסי או ה-VPN ונסה שוב.',
    errCertError: 'אימות אישור האבטחה נכשל. בדוק את שעון המערכת, האישור הארגוני או הגדרות הפרוקסי.',
    errNetworkUnreachable: 'לא ניתן להגיע לשרת ה-AI. בדוק את חיבור האינטרנט, ה-DNS או חומת האש.',
    errTimeout: 'תם הזמן הקצוב להמתנה לתגובת ה-AI. נסה שוב בעוד רגע או פצל את הבקשה.',
  },
  hi: {
    slowResponseHint:
      'जवाब आने में सामान्य से अधिक समय लग रहा है। आप प्रतीक्षा जारी रख सकते हैं या अनुरोध कभी भी रोक सकते हैं।',
    errProxyError:
      'प्रॉक्सी के माध्यम से कनेक्शन विफल रहा। अपनी प्रॉक्सी या VPN सेटिंग्स जाँचें और पुनः प्रयास करें।',
    errCertError:
      'सुरक्षा प्रमाणपत्र सत्यापन विफल रहा। सिस्टम समय, कॉर्पोरेट प्रमाणपत्र या प्रॉक्सी सेटिंग्स जाँचें।',
    errNetworkUnreachable:
      'AI सर्वर से संपर्क नहीं हो सका। अपना इंटरनेट कनेक्शन, DNS या फ़ायरवॉल जाँचें और पुनः प्रयास करें।',
    errTimeout:
      'AI प्रतिक्रिया का समय समाप्त हो गया। थोड़ी देर बाद फिर कोशिश करें या अनुरोध को छोटे हिस्से में बाँटें।',
  },
  'zh-TW': {
    slowResponseHint: '回應時間比平時更長。您可以繼續等候，或隨時停止請求。',
    errProxyError: '無法透過 Proxy 連線。請檢查 Proxy 設定或 VPN 後再試一次。',
    errCertError: '安全性憑證驗證失敗。請檢查系統時間、企業根憑證或 Proxy 設定後重試。',
    errNetworkUnreachable: '無法連線至 AI 伺服器。請檢查網路連線、DNS 或防火牆設定後重試。',
    errTimeout: 'AI 回應逾時。請稍後再試，或將請求拆分為較小的步驟。',
  },
  vi: {
    slowResponseHint:
      'Phản hồi đang mất nhiều thời gian hơn bình thường. Bạn có thể tiếp tục chờ hoặc dừng yêu cầu bất cứ lúc nào.',
    errProxyError: 'Không thể kết nối qua proxy. Hãy kiểm tra cài đặt proxy hoặc VPN rồi thử lại.',
    errCertError:
      'Xác minh chứng chỉ bảo mật thất bại. Hãy kiểm tra giờ hệ thống, chứng chỉ nội bộ hoặc cài đặt proxy.',
    errNetworkUnreachable:
      'Không thể kết nối tới máy chủ AI. Hãy kiểm tra kết nối mạng, DNS hoặc tường lửa rồi thử lại.',
    errTimeout: 'Hết thời gian chờ phản hồi từ AI. Hãy thử lại sau ít phút hoặc chia nhỏ yêu cầu.',
  },
  tr: {
    slowResponseHint:
      'Yanıt normalden uzun sürüyor. Beklemeye devam edebilir veya isteği istediğiniz zaman durdurabilirsiniz.',
    errProxyError:
      'Proxy üzerinden bağlanılamadı. Proxy veya VPN ayarlarınızı kontrol edip yeniden deneyin.',
    errCertError:
      'Güvenlik sertifikası doğrulanamadı. Sistem saatini, kurumsal sertifikayı veya proxy ayarlarını kontrol edin.',
    errNetworkUnreachable:
      'Yapay zeka sunucusuna ulaşılamıyor. İnternet bağlantınızı, DNS veya güvenlik duvarı ayarlarınızı kontrol edin.',
    errTimeout:
      'Yapay zeka yanıtı zaman aşımına uğradı. Kısa bir süre sonra yeniden deneyin veya isteği daha küçük parçalara bölün.',
  },
})

export type AiDiagnosticsStringKey = keyof typeof AI_DIAGNOSTICS_STRINGS.zh

export const aiDiagnosticsText: (
  lang: Lang,
  key: AiDiagnosticsStringKey,
  params?: Params,
) => string = createI18n(AI_DIAGNOSTICS_STRINGS)
