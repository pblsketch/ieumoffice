# Panel asisten AI

Setiap editor bisa memunculkan panel AI: pilih sesuatu, beri instruksi, dan lihat hasilnya mengalir.

## Membuka dan menggunakannya

- Panel ini memerlukan AI yang terhubung. Jika belum ada, panel menampilkan kartu koneksi, bukan pesan galat; lihat [Koneksi langganan](help://subscription).
- Titik masuknya: **tombol AI** di pita setiap editor, **Tanya AI** di menu konteks, atau Tanya AI pada bilah anotasi.
- Jelaskan tugas dengan bahasa sehari-hari (tulis ulang ini / jadikan kolom ini persentase / tata ulang halaman ini...) lalu tekan Enter.
- Balasan dirender **secara bertahap**; ketika AI membutuhkan alat (membaca dokumen, mengeditnya), AI menjalankannya dan melanjutkan sampai selesai.
- **Berhenti**: hentikan putaran yang sedang berjalan kapan saja.
- **Antrean**: saat balasan sedang mengalir, Enter menaruh pesan Anda ke antrean alih-alih membuangnya — strip di atas kotak masukan menghitungnya; buka untuk menyunting, menghapus, mengurutkan ulang, menjeda, atau mengosongkan. Pesan berikutnya terkirim sendiri saat giliran selesai; Esc tetap menghentikan giliran.

## AI mana yang menjawab

- Daftar model di bagian bawah panel menunjukkan AI yang sedang dipakai dan memungkinkan Anda memilih yang lain: langganan Anda lebih dulu, lalu penyedia berbasis kunci yang sudah Anda siapkan.
- Setelah Anda memakai 80% atau lebih dari batas langganan, baris seperti "85% terpakai · diatur ulang pada 15.00" muncul di panel.
- Jika sebuah permintaan dihentikan — batasnya habis, atau sesi masuk berakhir — panel menyebutkan alasannya dan tidak beralih sendiri ke AI lain. Bila langganan Anda yang lain terhubung, tombol **Lanjutkan dengan …** menawarkannya.

## Apa yang dapat dilakukan

- **Docs**: menulis ulang/memperluas/menerjemahkan/merangkum, menyisipkan tabel dan gambar, menyesuaikan format; setiap putaran menyimpan snapshot lebih dulu.
- **Sheets**: rumus, pengisian data, transformasi massal, format.
- **Slides**: pembuatan seluruh dek, penyesuaian tata letak, penulisan ulang naskah.
- **PDF**: tanya jawab dan ringkasan berdasarkan teks atau halaman yang dipilih.
- **Markdown / HTML**: menulis ulang, mengembangkan, menerjemahkan.
- **Beranda ▸ Ask AI** menjawab dari berkas berbintang Anda dan mengutipnya — panel basis pengetahuan punya bagiannya sendiri di bab Beranda, dan panel AI Docs membawa keterampilan yang sama.

## Melampirkan dokumen yang terbuka

Di panel AI editor Docs, Sheets, Slides, Hangul, HTML, dan peta pikiran, Anda dapat melampirkan dokumen lain yang sedang terbuka di GenOffice, atau yang baru-baru ini dibuka, sebagai bahan. Dokumen yang dilampirkan diperlakukan sama persis seperti berkas yang dipilih dari PC Anda.

- **`@` di kotak masukan**: ketik `@` di awal kotak masukan atau setelah spasi untuk membuka daftar dokumen. Jika jendela dibagi, dokumen di panel sebelah muncul paling atas, lalu dokumen lain yang terbuka dan dokumen terbaru; dokumen yang sedang Anda kerjakan tidak ikut ditampilkan. Persempit dengan beberapa huruf dari namanya (spasi boleh) lalu pilih dengan Enter atau klik: `@nama dokumen` masuk ke kotak masukan dan dokumennya terlampir. **Cari lainnya…** di bagian paling bawah membuka jendela pemilih dokumen yang dijelaskan di bawah.
- **Lampirkan dari dokumen GenOffice**: tombol di samping tombol lampiran ini membuka daftar yang sama dalam jendela, tempat Anda dapat mencentang beberapa dokumen dan melampirkannya sekaligus.
- Dokumen yang punya perubahan belum disimpan dan dokumen baru yang belum pernah disimpan tampak redup dan tidak dapat dipilih. Simpan dulu, lalu pilih lagi — AI membaca berkas yang tersimpan.
- Jika dua dokumen bernama sama tetapi berada di folder berbeda, nama folder tepat di atasnya ikut ditambahkan, seperti `@rencana.docx(Semester 2)`, dan nama folder itu juga diberikan kepada AI.
- Editor PDF dan Markdown belum memiliki lampiran, jadi kedua cara itu tidak tersedia di sana.

## Proyek

- Klik nama proyek di sebelah kiri, di bawah kotak masukan, untuk memilih proyek (satu folder di PC Anda). AI lalu menjawab dengan mengetahui file, instruksi, dan memori folder itu, dan obrolannya disimpan di folder tersebut sehingga bisa dilanjutkan di editor lain. Lihat [Proyek](help://projects).
- Setelah proyek dipilih, judul obrolan yang sedang berjalan tampil di bagian atas panel. Klik untuk melihat daftar obrolan proyek ini dan **Obrolan baru**.
- Daftar `@` di kotak masukan menampilkan "File di proyek ini" setelah dokumen yang terbuka.
- Permintaan dengan proyek terpilih juga mengirim instruksi (bersama `AGENTS.md` dan `CLAUDE.md` di puncak folder, yang bisa dimatikan di halaman proyek), memori, dan daftar nama file proyek itu, cuplikan singkat dari setiap file yang ditemukan AI saat mencari di folder, serta teks file apa pun yang dibaca AI, ke AI yang Anda pakai.

## Pengembalian dan keamanan

- Panel Docs menyimpan **daftar versi**: satu snapshot per putaran, Anda bisa mundur ke mana pun, dan rollback itu sendiri bisa dibatalkan dengan Ctrl+Z. Snapshot tetap ada setelah dokumen ditutup lalu dibuka kembali.
- suntingan AI melewati alur penyuntingan yang sama dengan suntingan manual (bisa di-undo, dan tunduk pada simpan) — tidak ada yang melewati konfirmasi simpan Anda.

## Sembunyikan informasi sensitif

- Di editor Docs, Sheets, Slides, Hangul, Markdown, dan HTML Anda bisa menjaga sebagian dokumen agar tidak sampai ke AI: pilih bagian itu, klik kanan ▸ **Sembunyikan informasi sensitif**, lalu beri label. AI membaca `{{label}}` di tempatnya, AI mana pun yang Anda pakai. (Markdown mengaktifkan item ini dengan sakelar mata-coreng di pitanya; item HTML ada di panel sumber; di Sheets, klik kanan header kolom untuk menyembunyikan kolom di bawah baris judulnya, atau rentang sel untuk menyembunyikan rentang itu saja.)
- Berkas tetap menyimpan teks asli — menyimpan, mengekspor, dan mencetak tidak terpengaruh, dan tandanya tetap ada setelah dibuka ulang. Menu yang sama menghentikan penyembunyian. Di Hangul setiap bagian tersembunyi menjadi komentar bertuliskan `[Sembunyikan informasi sensitif] label`, sehingga penerima dokumen juga melihat komentar itu, dan teks yang sudah punya komentar tidak bisa disembunyikan. Di Sheets tandanya berupa nama yang ditentukan `IeumHide_label`, yang tampak di Manajer Nama; AI melihat setiap sel tersembunyi sebagai `{{label-01}}` (nilai yang sama mendapat nomor yang sama), dan sel yang rumusnya memakai sel tersembunyi ikut disembunyikan.
- **Cari informasi sensitif** di panel AI menampilkan daftar teks yang tampak seperti nama, nomor telepon, alamat e-mail, nomor registrasi penduduk, nomor rekening dan kartu, alamat, dan sejenisnya. Pencarian dilakukan di PC ini saja dengan pola teks tetap — tidak ada AI yang dipakai untuk mencari maupun menyembunyikan — dan tidak ada yang disembunyikan sampai Anda memilih **Sembunyikan**. **Kecualikan** membuat kandidat itu tidak muncul lagi untuk dokumen tersebut. Tempat yang tidak bisa memuat tanda (header, catatan pembicara, nama lembar, …) ikut tercantum agar Anda bisa mengubahnya sendiri.
- Saat pertama kali mengirim di sebuah tab, jika dokumen atau lampiran permintaan itu masih berisi kandidat seperti itu, panel bertanya sekali: **Periksa** tidak mengirim apa pun dan membuka daftarnya, **Tetap kirim** langsung mengirim.
- HTML menyembunyikan isi elemen, nilai atribut, dan literal string di skrip, dan halaman yang dirender tidak pernah berubah. Slides juga menyembunyikan gambar, video, dan audio utuh, dan slide berisi konten tersembunyi tidak pernah dikirim sebagai tangkapan layar.
- Bagian tersembunyi tetap tersembunyi saat berkasnya dilampirkan di editor lain, ditanyakan di Beranda, dibaca oleh perintah `ieumoffice` dan alat MCP-nya, atau dibaca lewat server MCP aplikasi. Mengonversi ke format yang tidak punya tempat untuk tanda (ODT, CSV, …) akan bertanya dulu. Penyembunyian tidak berlaku untuk berkas yang dibaca langsung dari disk oleh program mode agen, dan gambar halaman (`render`) menampilkan teks apa adanya.

## Privasi

- Instruksi dan isi dokumen yang relevan dikirim ke **AI yang Anda pakai**: ke Anthropic atau OpenAI dengan akun Anda sendiri bila Anda memakai langganan, atau ke penyedia yang kuncinya Anda masukkan. Jika tidak ada AI yang terhubung, tidak ada yang dikirim.
- Apakah isi yang dikirim lewat langganan dipakai untuk melatih AI ditentukan oleh pengaturan akun Anda sendiri di perusahaan tersebut.
- File lokal tidak diunggah ke mana pun; kunci API tersimpan di berkas pengaturan aplikasi pada mesin ini dan hanya dikirim di header permintaan.
