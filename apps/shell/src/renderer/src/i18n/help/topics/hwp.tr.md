# Hangul (HWP / HWPX): düzenleme, çalışma bölmesi ve yazdırma

GenOffice, `.hwp` ve `.hwpx` Hangul belgelerini bir sekmede açar ve düzenler; klavye kısayollarını, stilleri, tabloları, notları, yazdırmayı ve bir AI panelini bir arada sunar. Her şey bilgisayarınızda yerel olarak çalışır.

## Açma, kaydetme ve yazdırma

- `.hwp` ve `.hwpx` dosyalarını Giriş ekranından, **Dosya > Aç** menüsünden, pencereye sürükleyerek veya Google Drive üzerinden açar; **Dosya > PDF İçe Aktar** ile PDF dosyalarını yeni Hangul sekmelerine dönüştürür.
- Açılan dosyanın kendi biçiminde kaydeder (`.hwp` yine `.hwp`, `.hwpx` yine `.hwpx` kalır), ilk üzerine yazmadan önce `.bak` yedeği saklar, HWP geri okuma kontrolü yapar ve Otomatik Kaydetme ile çökme kurtarma kopyalarını korur.
- Yazdır (Ctrl+P) canlı önizleme, PDF dışa aktarma ve çok sayfalı yazdırma düzeni seçeneklerini destekler.

## Sol çalışma bölmesi: Anahat ve Bul

- Sol çalışma bölmesini üst çubuktaki düğmeden, **Görünüm > Çalışma bölmesi** (Anahat / Bul) menüsünden açın veya doğrudan Bul sekmesine geçmek için **Ctrl+F** tuşlarına basın. Geleneksel Bul (**Ctrl+Q,F**) ve Bul ve Değiştir (**Ctrl+H**) kullanılmaya devam eder.
- **Anahat sekmesi**: yerel Hangul anahat başlıklarını ve stille eşlenen başlıkları listeler (varsayılan `제목 N` / `Heading N`, Anahat ayarları çekmecesinden belge bazında veya uygulama genelinde özelleştirilebilir). Düzeye göre filtreleyin (`1`, `2`, `3`, ... Tümü), dalları daraltın, atlamak için tıklayın, başlık düzeyini yükseltin veya düşürün (varsayılan olarak alt başlıklarla birlikte ya da tek başlık için **Shift** tuşunu basılı tutarak) ve tüm bölümleri tek bir geri alma adımında yeniden sıralamak için başlıkları sürükleyin.
- **Bul sekmesi**: gövde metni, tablolar (iç içe tablolar dahil), metin kutuları, dipnotlar ve sonnotlar genelinde (üstbilgi ve altbilgiler hariç) büyük/küçük harf duyarlılığı, tam sözcük, düzenli ifadeler, paragraf stili ve karakter biçimlendirme filtreleriyle arama yapar. Bir sonuca tıklayarak atlayıp seçin ya da tek bir, seçili veya tüm eşleşmeleri tek bir geri alma adımında değiştirin (satır içi nesneler ve alıntı işaretleri sayısı gösterilerek atlanır).
- Çalışma bölmesi açık kalma durumunu, etkin sekmesini ve genişliğini hatırlar, dar pencerelerde simge şeridine katlanır ve sunum modu ile yazdırma önizlemesinde gizlenir. Tüm çalışma bölmesi özellikleri AI olmadan çalışır.

## Notlar, kısayollar ve AI paneli

- Belgenin yanında düz metin notları okumak, eklemek, düzenlemek ve silmek için üst çubuktan veya **Ekle > Not** menüsünden Not sütununu açın.
- Hangul belge düzenleme kısayollarını, yatay cetvel paragraf işaretlerini, Biçim Kopyala (**Alt+C**), Hanja dönüştürme (**F9** / Hanja tuşu) ve Belge Bilgisi (**Ctrl+Q,I**) özelliklerini destekler.
- İsteğe bağlı AI paneli ve [terminal komutları](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) metin, stiller, tablolar, denklemler, sayfa düzeni, anahat ve arama sonuçlarını okuyup düzenleyebilir; her AI düzenlemesi tek bir geri alma adımıdır.
