# Operasi file: ganti nama, hapus, ekspor

Bab ini mencakup operasi file yang dipakai bersama oleh semua editor; pilihan ekspor khas tiap editor ada di babnya masing-masing.

**Menu ⋯** pada baris file (arahkan kursor ke baris file) mengumpulkan tindakan berikut:

![Menu ⋯ pada baris file](img/file-ops.png)

## Mengganti nama

Ada dua pintu masuk, satu set pemeriksaan:

- **⋯ ▸ Ganti nama** dari baris di Beranda.
- **Klik dua kali tab file** untuk mengganti nama di tempat (lihat [Tab dan pengelolaan jendela](help://tabs-and-windows)).

Aturannya: ekstensi dipertahankan otomatis; karakter terlarang, titik di akhir, dan nama cadangan (CON/NUL dan sejenisnya) ditolak dengan pesan; dan nama yang bentrok di folder yang sama juga dicegah. Berkas sungguhan di disk diganti namanya, serta daftar terbaru dan bintang ikut menyesuaikan.

## Menghapus

- **⋯ ▸ Hapus** di Beranda: menanyakan file mana, lalu memindahkannya ke **tempat sampah sistem**, tempat sistem operasi dapat memulihkannya. GenOffice tidak menyimpan undo sendiri untuk ini — pemulihan adalah urusan tempat sampah, bukan notifikasi.

## Duplikat

**⋯ ▸ Duplikat** membuat salinan <nama> di folder yang sama; bila nama bertabrakan, angka ditambahkan otomatis. Salinan masuk ke **Terbaru** alih-alih langsung dibuka — satu klik lagi, bukan tepat di depan Anda.

## Simpan dan Simpan Sebagai

- **⌘S / ctrl+S** menyimpan file saat ini; file tanpa nama akan lebih dulu meminta lokasi dan nama.
- Di sebagian besar editor, daftar jenis berkas di dialog Simpan Sebagai juga menawarkan format ekspor (PDF, gambar, format dokumen lain). Memilih salah satunya hanya menulis salinan; dokumen yang terbuka dan tabnya tetap pada berkas asli. Gambar dari beberapa halaman dipecah menjadi `nama-01.png`, `nama-02.png`, ….
- **Docs**: daftar Simpan Sebagai juga menawarkan .hwp dan .hwpx (File ▸ Ekspor sebagai dokumen HWP… sama saja). Jika ada yang tidak bisa dipindahkan, seperti komentar, persamaan, atau kotak teks, Anda diberi tahu sebelum berkas ditulis.
- **Simpan Sebagai…** menulis berkas baru dan membiarkan aslinya tidak tersentuh; penyuntingan setelahnya menyasar berkas baru.
- Setiap penyimpanan bersifat atomik (berkas sementara + ganti nama); berhenti di tengah penulisan tidak akan merusak file.
- Simpan Otomatis mengikuti tombol di setiap editor; dokumen baru tanpa berkas sendiri mulai setelah penyimpanan pertamanya (lihat [Mulai cepat](help://getting-started)).

## Ekspor ke PDF

- **Docs**: Arquivo ▸ Ekspor sebagai PDF… (atau tombol di pita), dengan pemenggalan halaman seperti tata letaknya.
- **Slides**: ekspor meraster halaman demi halaman, dengan progres untuk dek besar.
- **Sheets**: ekspor mengikuti pemenggalan halaman cetak.
- Ekspor dirender di jendela tersembunyi dan hasilnya mendarat di mana pun yang Anda pilih.

## Ekspor ke Word / gambar

- **PDF ▸ PDF ke Word**: mengubah PDF menjadi .docx (dikonversi secara lokal; tata letak kompleks dibuat semaksimal mungkin).
- **Docs** dapat mengekspor halaman sebagai gambar (PNG per halaman).

## Mencetak

Berkas ▸ Cetak (⌘P/ctrl+P) membuka jendela cetak dengan pratinjau langsung di setiap editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram, dan Whiteboard. Jika tidak ada perubahan pada Tata letak halaman dan Anda memakai dialog cetak sistem, pencetakan berjalan seperti sebelumnya.

- **Tujuan keluaran (printer, PDF, gambar)**: pilih printer terpasang, **Simpan sebagai PDF**, **Simpan sebagai gambar**, atau **Dialog cetak sistem** dari satu daftar. Ekspor gambar mendukung PNG dan JPG (Tinggi 90%, Sedang 80%, Berkas kecil 65%), sebagai berkas bernomor terpisah atau satu arsip ZIP untuk banyak halaman. PDF dengan pembatasan izin menonaktifkan simpan PDF dan gambar, sementara pencetakan tetap tersedia.
- **Pratinjau cetak langsung**: seluruh sepuluh editor menampilkan pratinjau langsung sebelum keluaran. Saat tata letak, skala abu-abu, tanda air, atau header/footer mengubah sisi keluaran, pratinjau merender sisi sebenarnya sesuai kebutuhan lengkap dengan navigasi halaman, zoom, dan tombol diagram tata letak.
- **Tata letak**: pilih Satu halaman per lembar, Beberapa halaman per lembar (2, 4, 6, 9, atau 16, dengan opsi garis tepi halaman), Buklet (jilid kiri atau kanan), Poster (kolom × baris, tumpang tindih, garis potong, dan label koordinat ubin), atau Label (satu halaman per label atau ulangi, sel awal, preset A4, atau ukuran khusus).
- **Skala, orientasi, sisi, dan urutan**: pilih Ukuran sebenarnya (100%), Sesuaikan kertas, Perkecil halaman terlalu besar saja, atau Skala khusus (10%–400%), serta orientasi Otomatis, Potret, atau Lanskap. Hanya sisi ganjil, genap, dan urutan terbalik dihitung dari sisi akhir hasil tata letak.
- **Tanda air, header/footer, skala abu-abu, dan resolusi**: tambahkan tanda air teks atau gambar serta 6 slot header dan footer (judul, tanggal, nomor halaman, atau teks khusus) hanya untuk keluaran tanpa mengubah dokumen asli. Atur juga skala abu-abu dan DPI (Otomatis, 150, 300, atau 600 dpi).
- **Rentang halaman dan pilihan**: Docs dan Markdown menata ulang teks terpilih dari halaman 1; Slides mencetak slide terpilih; PDF mencetak halaman terpilih; Hangul mendukung Semua, Halaman saat ini, atau Rentang khusus; Sheets mencetak lembar aktif, seluruh buku kerja, atau pilihan.
- **Dialog cetak sistem**: untuk buklet, pilih cetak bolak-balik dengan lipatan tepi pendek, dan biarkan rentang halaman serta halaman per lembar di dialog sistem apa adanya.

PDF dicetak sesuai urutan dan rotasi halaman saat ini.

## Di mana berkas tanpa nama tinggal

Lokasi yang Anda pilih saat penyimpanan pertama menjadi rumah berkas itu. Sebelumnya dokumen belum punya berkas sendiri: kontennya yang belum disimpan hanya ada sebagai salinan pemulihan di folder data aplikasi, sehingga bisa kembali jika aplikasi mati mendadak (lihat [Tab dan pengelolaan jendela](help://tabs-and-windows)). Simpan Otomatis baru mengambil alih setelah penyimpanan pertama itu.
