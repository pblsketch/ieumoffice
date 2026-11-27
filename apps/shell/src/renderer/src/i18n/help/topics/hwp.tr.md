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

## İçindekiler: oluşturma ve yenileme

- Anahat görünümündeki başlıklardan bir **İçindekiler** tablosunun yanı sıra nesne açıklamaları ve açıklama paragraflarından **Tablo Listesi**, **Şekil Listesi** ve **Denklem Listesi** eklemek için **Araçlar > İçindekiler Oluştur** (veya **Araçlar > İçindekileri Yenile** ya da içindekiler içinde sağ tıklama) menüsünü kullanın.
- **Noktalı sekme** (varsayılan) veya **Kenarlıksız tablo** (2 sütunlu) düzenini seçin, başlık derinliğini (düzey 1–10, varsayılan 3) ve başlığı ayarlayın, isterseniz tıklanabilir bağlantılar ekleyin (doğrudan ilgili başlığa atlamak için satıra tıklayın veya **Ctrl+tıklayın**).
- Sayfa numaraları, yeni numaradan başlatma ve Romen ya da özel sayı biçimleri dahil olmak üzere yazdırılan sayfa numaralandırmasını yansıtır.
- Yenileme, girdileri ve sayfa numaralarını yerinde günceller, elle düzenlediğiniz satırların üzerine yazmadan önce uyarır ve başka bir programla oluşturulmuş işaretsiz mevcut içindekiler tablolarını algılayarak değiştirmeden önce onayınızı ister.

## Dizin: girdi işaretleme ve oluşturma

- Seçili sözcüğü veya imleçteki sözcüğü işaretlemek, isteğe bağlı alt girdi eklemek ya da eşleşen tüm geçmeleri işaretlemek için **Araçlar > Dizin Girdisi İşaretle** (veya gövde metninde sağ tıklama) seçeneğini açın (yalnızca gövde metni; tablo, metin kutusu ve notlarda atlanan sayı bildirilir). Mevcut işaretleri aynı iletişim kutusunda görüntüleyip silebilirsiniz.
- İmleç konumuna dizin eklemek için **Araçlar > Dizin Oluştur**, düzenlemelerden sonra güncellemek için **Araçlar > Dizini Yenile** kullanın. Varsayılan başlık ("Dizin") özelleştirilebilir.
- Girdiler Korece (가나다) → İngilizce (ABC) → Diğer sırasıyla sıralanır; isteğe bağlı harf/ünsüz grup başlıkları, 1–3 sütun (varsayılan 2 sütun, yalnızca dizin bölümüne uygulanır ve belgenin geri kalanındaki sütunlar değişmez) ve **Noktalı sekme** ya da **Kenarlıksız tablo** düzeni seçilebilir.

## Güncel olmayan öğe uyarısı ve teslim kopyası

- Elle Kaydet, Yazdır, PDF Olarak Dışa Aktar veya Teslim kopyası olarak kaydet işlemlerinde düzenleyici, içindekiler tablolarının veya dizinin güncel olup olmadığını denetler ve tümünü tek bir geri alma adımında yenilemeyi önerir. Bu denetim Otomatik Kaydetme sırasında asla çalışmaz ve kaydetmeyi engellemez.
- **Dosya > Teslim kopyası olarak kaydet** komutu, içindekiler tablolarını, başlık bağlantı noktalarını ve içindekiler bağlantılarını korurken dahili düzenleme işaretlerinden (dizin işaretleri, dizin bloğu işaretleri ve kayıtlı ayarlar) arındırılmış ayrı ve temiz bir kopya kaydeder. Özgün çalışma dosyanız bozulmadan kalır, böylece daha sonra yenilemeye devam edebilirsiniz.
