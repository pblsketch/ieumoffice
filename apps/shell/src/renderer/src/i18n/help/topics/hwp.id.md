# Hangul (HWP / HWPX): penyuntingan, panel kerja, dan pencetakan

GenOffice membuka dan menyunting dokumen Hangul `.hwp` dan `.hwpx` di dalam tab, dengan dukungan pintasan papan ketik, gaya, tabel, memo, pencetakan, dan panel AI. Semuanya berjalan secara lokal di PC Anda.

## Membuka, menyimpan, dan mencetak

- Membuka file `.hwp` dan `.hwpx` dari Beranda, **File > Buka**, menyeret ke jendela, atau Google Drive; mengonversi PDF menjadi tab Hangul baru melalui **File > Impor PDF**.
- Menyimpan kembali dalam format file yang dibuka (`.hwp` tetap `.hwp`, `.hwpx` tetap `.hwpx`), menyimpan cadangan `.bak` sebelum penimpaan pertama, memeriksa pembacaan ulang HWP, serta menjaga salinan Simpan Otomatis dan pemulihan kerusakan.
- Cetak (Ctrl+P) mendukung pratinjau langsung, ekspor PDF, dan opsi tata letak cetak multi-halaman.

## Panel kerja kiri: Kerangka, Cari, dan Referensi

- Buka panel kerja kiri dari tombol bilah atas, **Tampilan > Panel kerja** (Kerangka / Cari / Referensi), atau tekan **Ctrl+F** untuk langsung menuju tab Cari. Cari tradisional (**Ctrl+Q,F**) serta Cari & Ganti (**Ctrl+H**) tetap tersedia.
- **Tab Kerangka**: menampilkan judul kerangka asli Hangul dan judul yang dipetakan dari gaya (bawaan `제목 N` / `Heading N`, dapat disesuaikan per dokumen atau di seluruh aplikasi pada laci pengaturan Kerangka). Saring menurut tingkat (`1`, `2`, `3`, ... Semua), lipat cabang, klik untuk melompat, naikkan atau turunkan tingkat judul (beserta subjudul secara bawaan, atau tahan **Shift** untuk satu judul saja), dan seret judul untuk menyusun ulang seluruh bagian dalam satu langkah urungkan.
- **Tab Cari**: mencari di seluruh teks isi, tabel (termasuk tabel bersarang), kotak teks, catatan kaki, dan catatan akhir (tidak termasuk header dan footer) dengan filter huruf besar/kecil, kata utuh, ekspresi reguler, gaya paragraf, dan pemformatan karakter. Klik hasil untuk melompat dan memilihnya, atau ganti satu, yang dipilih, atau semua kecocokan dalam satu langkah urungkan (melewati objek sebaris dan tanda kutipan sambil menampilkan jumlahnya).
- Panel kerja mengingat status terbuka, tab aktif, dan lebarnya, melipat menjadi bilah ikon pada jendela sempit, serta bersembunyi di mode presentasi dan pratinjau cetak. Semua fitur panel kerja berfungsi tanpa AI.

## Memo, pintasan, dan panel AI

- Buka kolom Memo dari bilah atas atau **Sisipkan > Memo** untuk membaca, menambah, menyunting, dan menghapus memo teks biasa di samping dokumen.
- Mendukung pintasan penyuntingan dokumen Hangul, penanda paragraf penggaris horizontal, Salin Format (**Alt+C**), konversi Hanja (**F9** / tombol Hanja), dan Info Dokumen (**Ctrl+Q,I**).
- Panel AI opsional dan [perintah terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) dapat membaca dan menyunting teks, gaya, tabel, persamaan, tata letak halaman, kerangka, dan hasil pencarian; setiap suntingan AI menjadi satu langkah urungkan.

## Daftar Isi: membuat dan memperbarui

- Gunakan **Alat > Buat Daftar Isi** (atau **Alat > Perbarui Daftar Isi**, atau klik kanan di dalam daftar isi) untuk menyisipkan **Daftar Isi** dari judul di Kerangka, serta **Daftar Tabel**, **Daftar Gambar**, dan **Daftar Persamaan** dari keterangan objek dan paragraf keterangan.
- Pilih tata letak **Tab bertitik** (bawaan) atau **Tabel tanpa batas** (2 kolom), atur kedalaman judul (tingkat 1–10, bawaan 3), sesuaikan judulnya, dan aktifkan tautan yang dapat diklik jika diinginkan (klik atau **Ctrl+klik** baris daftar isi untuk langsung melompat ke judul terkait).
- Nomor halaman mengikuti penomoran halaman cetak, termasuk mulai nomor baru serta format angka Romawi atau kustom.
- Pembaruan menyegarkan entri dan nomor halaman di tempat, memberi peringatan sebelum menimpa baris yang diedit secara manual, serta mendeteksi daftar isi tanpa penanda yang dibuat oleh program lain dan meminta konfirmasi sebelum menggantinya.

## Indeks: menandai entri dan membuat indeks

- Gunakan **Alat > Tandai Entri Indeks** (atau klik kanan di teks isi) untuk menandai kata yang dipilih atau kata di posisi kursor, menambahkan sub-entri opsional, atau menandai semua kemunculan yang cocok (hanya teks isi; jumlah kemunculan yang dilewati di dalam tabel, kotak teks, dan catatan akan dilaporkan). Anda juga dapat melihat dan menghapus tanda yang ada di dialog yang sama.
- Gunakan **Alat > Buat Indeks** untuk menyisipkan indeks di posisi kursor, lalu **Alat > Perbarui Indeks** setelah melakukan pengeditan. Judul bawaan ("Indeks") dapat diubah.
- Entri diurutkan berdasarkan urutan Korea (가나다) → Inggris (ABC) → Lainnya, dengan judul kelompok huruf/konsonan opsional, 1–3 kolom (bawaan 2 kolom, hanya berlaku pada area indeks sehingga kolom dokumen lainnya tetap sama), serta tata letak **Tab bertitik** atau **Tabel tanpa batas**.

## Peringatan pembaruan dan Salinan Penyerahan

- Saat Anda melakukan Simpan manual, Cetak, Ekspor sebagai PDF, atau Simpan sebagai Salinan Penyerahan, editor memeriksa apakah daftar isi atau indeks sudah usang dan menawarkan untuk memperbarui semuanya dalam satu langkah urung (undo). Pemeriksaan ini tidak pernah berjalan saat Simpan Otomatis dan tidak pernah memblokir penyimpanan.
- Gunakan **File > Simpan sebagai Salinan Penyerahan** untuk menyimpan salinan bersih terpisah tanpa tanda penyuntingan internal (tanda indeks, tanda blok indeks, dan pengaturan tersimpan), sementara daftar isi, jangkar judul, dan tautan daftar isi tetap utuh. File kerja asli Anda tetap tidak berubah sehingga Anda masih dapat memperbaruinya nanti.

## Referensi dan kutipan

- Buka tab **Referensi** di panel kerja kiri (atau **Alat > Referensi**) untuk mengelola satu pustaka referensi lokal di PC Anda lengkap dengan pencarian, tag, tambah/sunting/hapus, impor dan ekspor (`BibTeX`, `RIS`, `CSL JSON`), serta impor baris dari daftar referensi dokumen yang sudah ada melalui pratinjau konfirmasi.
- Mendukung empat gaya kutipan (**APA 7**, **Chicago**, **MLA 9**, dan **IEEE**; referensi berbahasa Korea mengikuti format akademik Korea di keempat gaya). Sisipkan kutipan dalam kurung, naratif, atau multi-entri beserta penunjuk halaman, lalu buat atau perbarui daftar pustaka dengan indentasi gantung; mengganti gaya akan memperbarui kutipan bertanda dan daftar pustaka dalam satu langkah urungkan tanpa mengubah kutipan yang disunting manual.
- Tab pemeriksaan bawaan 6 poin (hilang dari daftar pustaka, entri belum dikutip, urutan penyortiran, akhiran a/b yang kurang, suntingan manual, dan item belum terverifikasi) memungkinkan Anda melompat langsung ke tiap masalah, ditambah pengingat daftar pustaka atau penomoran IEEE yang usang sebelum simpan manual, cetak, atau ekspor.
- Pencarian referensi AI opsional (bila alat internet aktif) selalu menambahkan kandidat sebagai **Belum diverifikasi** dengan URL sumber di catatan; item tersebut tidak dapat dikutip atau dimasukkan ke daftar pustaka sampai Anda memeriksanya dan menandainya **Terverifikasi** sendiri.
