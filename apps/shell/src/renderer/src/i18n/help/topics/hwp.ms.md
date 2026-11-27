# Hangul (HWP / HWPX): penyuntingan, anak tetingkap kerja dan cetakan

GenOffice membuka dan menyunting dokumen Hangul `.hwp` dan `.hwpx` dalam tab, dengan pintasan papan kekunci, gaya, jadual, memo, pencetakan dan panel AI. Semuanya berjalan secara setempat pada PC anda.

## Membuka, menyimpan dan mencetak

- Membuka fail `.hwp` dan `.hwpx` daripada Laman Utama, **Fail > Buka**, dengan menyeret ke tetingkap, atau daripada Google Drive; menukar fail PDF kepada tab Hangul baharu melalui **Fail > Import PDF**.
- Menyimpan semula dalam format asal fail yang dibuka (`.hwp` kekal `.hwp`, `.hwpx` kekal `.hwpx`), menyimpan sandaran `.bak` sebelum tulis ganti pertama, menyemak bacaan semula HWP serta mengekalkan Simpan Auto dan salinan pemulihan ranap.
- Cetak (Ctrl+P) menyokong pratonton langsung, eksport PDF dan pilihan susun atur cetakan berbilang halaman.

## Anak tetingkap kerja kiri: Rangka, Cari dan Rujukan

- Buka anak tetingkap kerja kiri daripada butang bar atas, **Paparan > Anak tetingkap kerja** (Rangka / Cari / Rujukan), atau tekan **Ctrl+F** untuk terus ke tab Cari. Cari tradisional (**Ctrl+Q,F**) dan Cari & Ganti (**Ctrl+H**) kekal tersedia.
- **Tab Rangka**: menyenaraikan tajuk rangka asli Hangul dan tajuk yang dipetakan mengikut gaya (lalai `제목 N` / `Heading N`, boleh disesuaikan bagi setiap dokumen atau seluruh aplikasi dalam laci tetapan Rangka). Tapis mengikut tahap (`1`, `2`, `3`, ... Semua), lipat cabang, klik untuk melompat, naikkan atau turunkan tahap tajuk (bersama subtajuk secara lalai, atau tahan **Shift** untuk satu tajuk sahaja), dan seret tajuk untuk menyusun semula keseluruhan bahagian dalam satu langkah buat asal.
- **Tab Cari**: mencari di seluruh teks utama, jadual (termasuk jadual bersarang), kotak teks, nota kaki dan nota hujung (tidak termasuk pengepala dan pengaki) dengan penapis kepekaan huruf, perkataan penuh, ungkapan biasa, gaya perenggan dan pemformatan aksara. Klik hasil untuk melompat dan memilihnya, atau ganti satu, yang dipilih atau semua padanan dalam satu langkah buat asal (melangkau objek sebaris dan tanda petikan sambil menunjukkan bilangan).
- Anak tetingkap kerja mengingati keadaan terbuka, tab aktif dan lebarnya, dilipat menjadi rel ikon pada tetingkap sempit, dan disembunyikan dalam mod persembahan serta pratonton cetakan. Semua ciri anak tetingkap kerja berfungsi tanpa AI.

## Memo, pintasan dan panel AI

- Buka lajur Memo daripada bar atas atau **Sisip > Memo** untuk membaca, menambah, menyunting dan memadam memo teks biasa di sebelah dokumen.
- Menyokong pintasan penyuntingan dokumen Hangul, penanda perenggan pembaris mendatar, Salin Format (**Alt+C**), penukaran Hanja (**F9** / kekunci Hanja) dan Maklumat Dokumen (**Ctrl+Q,I**).
- Panel AI pilihan dan [arahan terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) boleh membaca dan menyunting teks, gaya, jadual, persamaan, susun atur halaman, rangka dan hasil carian; setiap suntingan AI ialah satu langkah buat asal.

## Jadual Kandungan: cipta dan segar semula

- Gunakan **Alat > Cipta Jadual Kandungan** (atau **Alat > Segar Semula Jadual Kandungan**, atau klik kanan di dalam jadual kandungan) untuk memasukkan **Jadual Kandungan** daripada tajuk dalam Rangka, serta **Senarai Jadual**, **Senarai Rajah**, dan **Senarai Persamaan** daripada kapsyen objek dan perenggan kapsyen.
- Pilih susun atur **Tab bertitik** (lalai) atau **Jadual tanpa sempadan** (2 lajur), tetapkan kedalaman tajuk (tahap 1–10, lalai 3), ubah suai tajuknya, dan sertakan pautan boleh klik secara pilihan (klik atau **Ctrl+klik** pada baris untuk melompat terus ke tajuk tersebut).
- Nombor halaman mencerminkan penomboran halaman cetakan, termasuk permulaan nombor baharu serta format angka Roman atau tersuai.
- Penyegaran semula mengemas kini entri dan nombor halaman di tempatnya, memberi amaran sebelum menulis ganti baris yang disunting secara manual, serta mengesan jadual kandungan sedia ada tanpa tanda yang dicipta oleh program lain dan meminta pengesahan sebelum menggantikannya.

## Indeks: tanda entri dan bina indeks

- Gunakan **Alat > Tanda Entri Indeks** (atau klik kanan pada teks isi) untuk menanda perkataan yang dipilih atau pada kursor, menambah subentri pilihan, atau menanda semua kemunculan yang sepadan (teks isi sahaja; bilangan kemunculan yang dilangkau dalam jadual, kotak teks, dan nota akan dilaporkan). Anda juga boleh melihat dan memadam tanda sedia ada dalam dialog yang sama.
- Gunakan **Alat > Cipta Indeks** untuk memasukkan indeks di kedudukan kursor, dan **Alat > Segar Semula Indeks** untuk mengemas kininya selepas suntingan. Tajuk lalai ("Indeks") boleh disesuaikan.
- Entri diisih mengikut turutan Korea (가나다) → Inggeris (ABC) → Lain-lain, dengan tajuk kumpulan konsonan/huruf pilihan, 1–3 lajur (lalai 2 lajur, dihadkan kepada kawasan indeks sahaja supaya susunan lajur dokumen lain kekal sama), dan susun atur **Tab bertitik** atau **Jadual tanpa sempadan**.

## Pemberitahuan lapuk dan Salinan Serahan

- Apabila anda melakukan Simpan secara manual, Cetak, Eksport sebagai PDF, atau Simpan sebagai Salinan Serahan, editor menyemak sama ada jadual kandungan atau indeks sudah lapuk dan menawarkan untuk menyegarkan semuanya dalam satu langkah buat asal. Semakan ini tidak pernah dijalankan semasa Autosimpan dan tidak pernah menyekat penyimpanan.
- Gunakan **Fail > Simpan sebagai Salinan Serahan** untuk menyimpan salinan bersih berasingan yang membuang tanda suntingan dalaman (tanda indeks, tanda blok indeks, dan tetapan tersimpan) sambil mengekalkan jadual kandungan, sauh tajuk, dan pautan jadual kandungan. Fail kerja asal anda kekal tidak disentuh supaya anda boleh terus menyegarkannya kemudian.

## Rujukan dan petikan

- Buka tab **Rujukan** pada anak tetingkap kerja kiri (atau **Alat > Rujukan**) untuk mengurus satu pustaka rujukan setempat pada PC anda dengan carian, tag, tambah/sunting/padam, import dan eksport (`BibTeX`, `RIS`, `CSL JSON`), serta mengimport baris daripada senarai rujukan sedia ada dalam dokumen dengan pratonton pengesahan.
- Menyokong empat gaya petikan (**APA 7**, **Chicago**, **MLA 9** dan **IEEE**; rujukan bahasa Korea mengikuti format akademik Korea dalam keempat-empat gaya). Masukkan petikan berkurungan, naratif atau berbilang entri dengan penunjuk halaman dan jana atau segar semula bibliografi berinden gantung; penukaran gaya mengemas kini petikan bertanda dan bibliografi dalam satu langkah buat asal sambil mengekalkan petikan yang disunting secara manual.
- Semakan terbina dalam 6 perkara (tiada dalam bibliografi, entri tidak dipetik, susunan isihan, akhiran a/b hilang, suntingan manual dan item belum disahkan) membolehkan anda melompat terus ke setiap isu, bersama peringatan bibliografi atau penomboran IEEE yang lapuk sebelum simpan manual, cetak atau eksport.
- Carian rujukan AI pilihan (apabila alat internet dihidupkan) sentiasa menambah calon sebagai **Belum disahkan** dengan URL sumber disimpan dalam nota; item tersebut tidak boleh dipetik atau dimasukkan ke dalam bibliografi sehingga anda sendiri menyemak dan menandakannya **Disahkan**.
