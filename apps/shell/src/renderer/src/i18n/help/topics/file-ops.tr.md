# Dosya işlemleri: yeniden adlandırma, silme, dışa aktarma

Bu bölüm her düzenleyicinin ortak kullandığı dosya işlemlerini anlatır; her düzenleyicinin kendi dışa aktarma seçenekleri kendi bölümündedir.

Bir dosya satırının üzerine geldiğinizde çıkan **⋯ menüsü** bu işlemleri bir araya toplar:

![Dosya satırının ⋯ menüsü](img/file-ops.png)

## Yeniden adlandırma

İki giriş noktası, tek bir dizi denetim:

- Giriş ekranındaki satırda **⋯ ▸ Yeniden adlandır**.
- **Bir dosya sekmesine çift tıklayın** ve adı yerinde değiştirin ([Sekmeler ve pencere yönetimi](help://tabs-and-windows) bölümüne bakın).

Kurallar: uzantı kendiliğinden korunur; geçersiz karakterler, sonu noktayla biten adlar ve ayrılmış adlar (CON/NUL ve benzerleri) bir iletiyle reddedilir; aynı klasörde ad çakışması da engellenir. Diskteki gerçek dosya yeniden adlandırılır, son kullanılanlar ve yıldızlılar da bunu izler.

## Silme

- Giriş ekranında **⋯ ▸ Sil**: hangi dosyaların silineceğini sorar, sonra onları işletim sisteminin geri getirebildiği **sistem çöp kutusuna** taşır. GenOffice bunun için kendi geri alma kaydını tutmaz — kurtarma, bir bildirimin değil çöp kutusunun işidir.

## Kopyasını oluşturma

**⋯ ▸ Kopyasını oluştur** aynı klasörde <ad> kopyası oluşturur; ad çakışmalarında kendiliğinden bir sayaç eklenir. Kopya önünüze açılmak yerine **Son kullanılanlar** listesine eklenir, böylece bir tık uzağınızda olur.

## Kaydetme ve Farklı Kaydetme

- **⌘S / ctrl+S** geçerli dosyayı kaydeder; dosyası olmayan bir belge önce konum ve ad sorar.
- Çoğu düzenleyicide Farklı Kaydet penceresindeki dosya türü listesi dışa aktarma biçimlerini de (PDF, resimler, diğer belge biçimleri) sunar. Bunlardan birini seçmek yalnızca bir kopya yazar; açık belge ve sekmesi özgün dosyada kalır. Birkaç sayfalık resimler `ad-01.png`, `ad-02.png`, … olarak bölünür.
- **Docs**: Farklı Kaydet listesi .hwp ve .hwpx de sunar (Dosya ▸ HWP Belgesi Olarak Dışa Aktar… aynı işi yapar). Açıklamalar, denklemler veya metin kutuları gibi bir şey aktarılamıyorsa dosya yazılmadan önce size söylenir.
- **Farklı kaydet** yeni bir dosya yazar, özgün dosyaya dokunmaz; sonraki düzenlemeler yeni dosyaya gider.
- Her kayıt atomiktir (geçici dosya + yeniden adlandırma); yazma sırasında kapanma dosyayı bozamaz.
- Otomatik kaydetme her düzenleyicinin kendi anahtarını izler; kendi dosyası olmayan yeni bir belge ilk kaydından sonra başlar ([Hızlı başlangıç](help://getting-started) bölümüne bakın).

## PDF olarak dışa aktarma

- **Docs**: Dosya ▸ PDF olarak dışa aktar (veya şerit düğmesi), sayfa düzeni korunarak sayfalanır.
- **Slides**: dışa aktarma her sayfayı ayrı ayrı görüntüye dönüştürür; büyük sunumlarda ilerleme gösterilir.
- **Sheets**: dışa aktarma yazdırma sayfalamasını izler.
- Dışa aktarmalar gizli bir pencerede işlenir ve seçtiğiniz yere yazılır.

## Word / görüntü olarak dışa aktarma

- **PDF ▸ Word’e dönüştür**: PDF’yi .docx dosyasına çevirir (dönüştürme yerelde yapılır; karmaşık düzenler elden geldiğince aktarılır).
- **Docs** sayfaları görüntü olarak dışa aktarabilir (her sayfa için bir PNG).

## Yazdırma

Her düzenleyicide — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram ve Whiteboard — Dosya ▸ Yazdır (⌘P/ctrl+P) canlı önizlemeli yazdırma penceresini açar. Sayfa düzeninde hiçbir ayar değiştirilmeden sistem yazdırma penceresi kullanıldığında yazdırma eskisi gibi çalışır.

- **Hedef (yazıcı, PDF, görseller)**: tek listeden kurulu bir yazıcı, **PDF olarak kaydet**, **Görsel olarak kaydet** veya **Sistem yazdırma penceresi** seçin. Görsel kaydetme PNG ve JPG (Yüksek %90, Orta %80, Küçük dosya %65) biçimlerini, çok sayfalı işler için ayrı numaralı dosyalar veya tek bir ZIP arşivi olarak destekler. İzin kısıtlı PDF’lerde PDF ve görsel kaydetme kapalıdır, yazdırma açıktır.
- **Canlı yazdırma önizlemesi**: on düzenleyicinin tümü çıktıdan önce canlı önizleme sunar. Düzen, gri tonlama, filigran veya üstbilgi/altbilgi çıktı yüzlerini değiştirdiğinde önizleme sayfaları isteğe bağlı olarak oluşturur; sayfa geçişi, yakınlaştırma ve yerleşim şeması geçişi sunar.
- **Yerleşim**: Yaprak başına tek sayfa, Yaprak başına çok sayfa (2, 4, 6, 9 veya 16; isteğe bağlı sayfa kenarlıkları), Kitapçık (sol veya sağ cilt), Poster (sütun × satır, bindirme, kesim çizgileri ve parça etiketleri) veya Etiketler (etiket başına tek sayfa ya da tekrar, başlangıç hücresi, A4 şablonları veya özel boyut) seçin.
- **Ölçek, yön, yüzler ve sıra**: Gerçek boyut (%100), Kağıda sığdır, Yalnızca büyük sayfaları küçült veya Özel ölçek (%10–%400) ile Otomatik, Dikey veya Yatay kağıt yönünü seçin. Yalnızca tek, yalnızca çift yüzler ve ters sıra nihai çıktı yüzlerine göre hesaplanır.
- **Filigran, üstbilgi/altbilgi, gri tonlama ve çözünürlük**: belgeyi değiştirmeden nihai yüzlere metin veya görsel filigran ile 6 bölmeli üstbilgi/altbilgi (başlık, tarih, sayfa numarası veya özel metin) ekleyin. Gri tonlama ve DPI (Otomatik, 150, 300 veya 600 dpi) kaliteyi belirler.
- **Sayfa aralıkları ve seçim**: Docs ve Markdown seçili metni 1. sayfadan yeniden sayfalandırır; Slides seçili slaytları; PDF seçili sayfaları; Hangul Tümü, Geçerli sayfa veya Özel aralık seçeneklerini; Sheets etkin sayfaları, çalışma kitabını veya seçimi yazdırır.
- **Sistem yazdırma penceresi**: kitapçık için kısa kenardan çevirmeli çift taraflı yazdırmayı seçin; sistem penceresindeki sayfa aralığı ve yaprak başına sayfa ayarlarına dokunmayın.

PDF’ler mevcut sayfa sırası ve döndürmeleriyle yazdırılır.

## Dosyası olmayan belgeler nerede durur

İlk kayıtta seçtiğiniz konum belgenin evidir. O ana kadar belgenin kendi dosyası yoktur: kaydedilmemiş içerik yalnızca uygulamanın veri klasöründe bir kurtarma kopyası olarak tutulur, böylece uygulama aniden kapanırsa geri gelebilir ([Sekmeler ve pencereler](help://tabs-and-windows) bölümüne bakın). Otomatik kaydetme ancak bu ilk kayıttan sonra devralır.
