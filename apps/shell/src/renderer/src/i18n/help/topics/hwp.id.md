# Hangul (HWP / HWPX): penyuntingan, panel kerja, dan pencetakan

GenOffice membuka dan menyunting dokumen Hangul `.hwp` dan `.hwpx` di dalam tab, dengan tetap mempertahankan pintasan Hancom Hangul 2024, gaya, tabel, memo, pencetakan, dan panel AI. Semuanya berjalan secara lokal di PC Anda.

## Membuka, menyimpan, dan mencetak

- Membuka file `.hwp` dan `.hwpx` dari Beranda, **File > Buka**, menyeret ke jendela, atau Google Drive; mengonversi PDF menjadi tab Hangul baru melalui **File > Impor PDF**.
- Menyimpan kembali dalam format file yang dibuka (`.hwp` tetap `.hwp`, `.hwpx` tetap `.hwpx`), menyimpan cadangan `.bak` sebelum penimpaan pertama, memeriksa pembacaan ulang HWP, serta menjaga salinan Simpan Otomatis dan pemulihan kerusakan.
- Cetak (Ctrl+P) mendukung pratinjau langsung, ekspor PDF, dan opsi tata letak cetak multi-halaman.

## Panel kerja kiri: Kerangka dan Cari

- Buka panel kerja kiri dari tombol bilah atas, **Tampilan > Panel kerja** (Kerangka / Cari), atau tekan **Ctrl+F** untuk langsung menuju tab Cari. Cari tradisional (**Ctrl+Q,F**) serta Cari & Ganti (**Ctrl+H**) tetap tersedia.
- **Tab Kerangka**: menampilkan judul kerangka asli Hangul dan judul yang dipetakan dari gaya (bawaan `제목 N` / `Heading N`, dapat disesuaikan per dokumen atau di seluruh aplikasi pada laci pengaturan Kerangka). Saring menurut tingkat (`1`, `2`, `3`, ... Semua), lipat cabang, klik untuk melompat, naikkan atau turunkan tingkat judul (beserta subjudul secara bawaan, atau tahan **Shift** untuk satu judul saja), dan seret judul untuk menyusun ulang seluruh bagian dalam satu langkah urungkan.
- **Tab Cari**: mencari di seluruh teks isi, tabel (termasuk tabel bersarang), kotak teks, catatan kaki, dan catatan akhir (tidak termasuk header dan footer) dengan filter huruf besar/kecil, kata utuh, ekspresi reguler, gaya paragraf, dan pemformatan karakter. Klik hasil untuk melompat dan memilihnya, atau ganti satu, yang dipilih, atau semua kecocokan dalam satu langkah urungkan (melewati objek sebaris dan tanda kutipan sambil menampilkan jumlahnya).
- Panel kerja mengingat status terbuka, tab aktif, dan lebarnya, melipat menjadi bilah ikon pada jendela sempit, serta bersembunyi di mode presentasi dan pratinjau cetak. Semua fitur panel kerja berfungsi tanpa AI.

## Memo, pintasan, dan panel AI

- Buka kolom Memo dari bilah atas atau **Sisipkan > Memo** untuk membaca, menambah, menyunting, dan menghapus memo teks biasa di samping dokumen.
- Menggunakan pintasan papan ketik Hancom Hangul 2024, penanda paragraf penggaris horizontal, Salin Format (**Alt+C**), konversi Hanja (**F9** / tombol Hanja), dan Info Dokumen (**Ctrl+Q,I**).
- Panel AI opsional dan [perintah terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) dapat membaca dan menyunting teks, gaya, tabel, persamaan, tata letak halaman, kerangka, dan hasil pencarian; setiap suntingan AI menjadi satu langkah urungkan.
