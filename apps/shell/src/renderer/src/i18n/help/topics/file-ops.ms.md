# Operasi fail: menamakan semula, memadam, dan eksport

Bab ini merangkumi operasi fail yang dikongsi oleh semua editor. Pilihan eksport khusus setiap editor ada dalam babnya sendiri.

**⋯ menu** pada baris fail, yang muncul apabila anda meletakkan penuding di atasnya, mengumpulkan tindakan berikut:

![⋯ menu pada baris fail](img/file-ops.png)

## Menamakan semula

Terdapat dua cara untuk mengakses, tetapi kedua-duanya menggunakan semakan yang sama:

- **⋯ ▸ Namakan semula** pada baris di Laman Utama.
- **Klik dua kali pada tab fail** untuk menamakan semula terus di tempat. Lihat [Tab dan pengurusan tingkap](help://tabs-and-windows).

Peraturannya ialah seperti berikut. Sambungan dikekalkan secara automatik. Aksara terlarang, titik di penghujung, dan nama yang dikhaskan seperti CON dan NUL akan ditolak dengan mesej. Pertindiran nama dalam folder yang sama juga akan disekat. Fail sebenar pada cakera akan dinamakan semula, dan senarai terkini serta senarai berbintang akan dikemas kini.

## Memadam

- **⋯ ▸ Padam** pada Laman Utama akan bertanya fail yang mana, kemudian memindahkan fail tersebut ke **tong sampah sistem**, yang boleh dipulihkan daripada sistem pengendalian. GenOffice tiada menyimpan undur sendiri untuk ini — pemulihan ialah tugas tong sampah, bukan notis.

## Membuat salinan

**⋯ ▸ Buat salinan** mencipta salinan bagi <nama> dalam folder yang sama. Jika nama itu sudah digunakan, nombor akan ditambah secara automatik. Salinan itu ditambah ke **Terkini** dan bukan dibuka untuk anda — satu klik sahaja, bukan di hadapan mata.

## Simpan dan Simpan Sebagai

- **⌘S atau ctrl+S** menyimpan fail semasa. Fail tanpa tajuk akan meminta lokasi dan nama terlebih dahulu.
- Dalam kebanyakan editor, senarai jenis fail dalam dialog Simpan Sebagai juga menawarkan format eksport (PDF, imej, format dokumen lain). Memilih salah satunya hanya menulis salinan; dokumen yang terbuka dan tabnya kekal pada fail asal. Imej beberapa halaman dipecahkan kepada `nama-01.png`, `nama-02.png`, ….
- **Docs**: senarai Simpan Sebagai juga menawarkan .hwp dan .hwpx (Fail ▸ Eksport sebagai dokumen HWP… melakukan perkara yang sama). Jika ada yang tidak dapat dipindahkan, seperti ulasan, persamaan atau kotak teks, anda dimaklumkan sebelum fail ditulis.
- **Simpan Sebagai** menulis fail baharu dan membiarkan fail asal tidak berubah. Suntingan selepas itu akan disimpan ke fail baharu itu.
- Setiap simpanan bersifat atomik, iaitu melalui fail sementara dan penamaan semula. Menutup aplikasi di tengah-tengah penulisan tidak akan merosakkan fail.
- Simpan automatik mengikut suis setiap editor; dokumen baharu tanpa fail sendiri bermula selepas simpanan pertamanya (lihat [Mula pantas](help://getting-started)).

## Eksport ke PDF

- **Docs**: Fail ▸ Eksport sebagai PDF, atau butang pada reben, dengan pemenggalan halaman seperti yang dipaparkan.
- **Slides**: eksport menukar setiap halaman kepada imej, dan menunjukkan kemajuan bagi persembahan yang besar.
- **Sheets**: eksport mengikut pemenggalan cetakan.
- Eksport dipaparkan dalam tingkap tersembunyi dan disimpan di tempat pilihan anda.

## Eksport ke Word dan imej

- **Eksport sebagai Word** menukar fail PDF kepada fail .docx. Penukaran ini dilakukan secara tempatan, dan susun atur yang kompleks hanya dipulihkan sepenuhnya.
- **Docs** boleh mengeksport halaman sebagai imej, iaitu PNG bagi setiap halaman.

## Cetakan

Fail ▸ Cetak (⌘P/ctrl+P) membuka tetingkap cetakan dengan pratonton langsung dalam setiap editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram dan Whiteboard. Jika tiada tetapan Susun atur halaman diubah dan dialog cetakan sistem dipilih, cetakan berfungsi seperti biasa.

- **Destinasi output (pencetak, PDF, imej)**: pilih pencetak terpasang, **Simpan sebagai PDF**, **Simpan sebagai imej**, atau **Dialog cetakan sistem** daripada satu senarai. Eksport imej menyokong PNG dan JPG (Tinggi 90%, Sederhana 80%, Fail kecil 65%) sebagai fail bernombor berasingan atau satu arkib ZIP bagi berbilang muka. PDF yang mempunyai sekatan kebenaran menyahdayakan simpanan PDF dan imej, namun cetakan masih dibenarkan.
- **Pratonton cetakan langsung**: kesemua sepuluh editor memaparkan pratonton langsung sebelum output. Apabila susun atur, skala kelabu, tera air atau pengepala/pengaki mengubah sisi output, pratonton memaparkan hasil sebenar atas permintaan berserta navigasi halaman, zum dan togol rajah susun atur.
- **Susun atur**: pilih Satu halaman sehelai, Beberapa halaman sehelai (2, 4, 6, 9 atau 16, dengan pilihan sempadan halaman), Buku kecil (jilid kiri atau kanan), Poster (lajur × baris, tindihan, garisan potong dan label koordinat jubin) atau Label (satu halaman setiap label atau ulang, sel mula, praset A4 atau saiz tersuai).
- **Skala, orientasi, sisi dan turutan**: pilih Saiz sebenar (100%), Muat ke kertas, Kecilkan halaman terlalu besar sahaja atau Skala tersuai (10%–400%), serta orientasi Automatik, Potret atau Landskap. Sisi ganjil, sisi genap dan susunan terbalik dikira berdasarkan sisi akhir output.
- **Tera air, pengepala/pengaki, skala kelabu dan resolusi**: tambah tera air teks atau imej serta 6 ruang pengepala dan pengaki (tajuk, tarikh, nombor halaman atau teks tersuai) pada output akhir tanpa mengubah dokumen asal. Kawal juga skala kelabu dan DPI (Automatik, 150, 300 atau 600 dpi).
- **Julat halaman dan pilihan**: Docs dan Markdown menyusun semula teks pilihan bermula halaman 1; Slides mencetak slaid dipilih; PDF mencetak halaman dipilih; Hangul menyokong Semua, Halaman semasa atau Julat tersuai; Sheets mencetak helaian aktif, buku kerja atau pilihan.
- **Dialog cetakan sistem**: bagi buku kecil, pilih cetakan dua muka pusing di tepi pendek dan biarkan julat halaman serta halaman sehelai dalam tetingkap sistem seperti asal.

PDF dicetak mengikut turutan dan putaran halaman semasa.

## Di mana fail tanpa tajuk berada

Lokasi yang anda pilih semasa simpanan pertama menjadi rumah fail tersebut. Sebelum itu, dokumen belum mempunyai fail sendiri: kandungannya yang belum disimpan hanya wujud sebagai salinan pemulihan dalam folder data aplikasi, jadi ia boleh kembali jika aplikasi tertutup secara tiba-tiba (lihat [Tab dan pengurusan tingkap](help://tabs-and-windows)). Autosimpan mengambil alih hanya selepas simpanan pertama itu.
