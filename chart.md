# TASK: Redesign & Upgrade KALYTH Candlestick Chart

Saya ingin melakukan perbaikan menyeluruh pada fitur **Candlestick Chart** di website KALYTH.

Website:
https://mcybernet.github.io/KALYTH/

Tujuan utama adalah menghasilkan candlestick chart dengan kualitas visual dan pengalaman penggunaan setara chart cryptocurrency profesional seperti TradingView dan Binance, tetapi tetap mempertahankan identitas visual KALYTH yang minimalis, elegan, dan modern.

## 1. Teknologi Utama

Gunakan:

**TradingView Lightweight Charts v5.x**

Official repository:
https://github.com/tradingview/lightweight-charts

Documentation:
https://tradingview.github.io/lightweight-charts/docs

GitHub:
https://github.com/tradingview/lightweight-charts

Ketentuan:
- Gunakan versi stabil terbaru yang kompatibel.
- Gunakan API resmi versi 5.x.
- Jangan menggunakan pola implementasi API versi 4.x yang sudah usang.
- Library harus digunakan sebagai mesin rendering chart utama.
- Jangan menggunakan TradingView Advanced Charts.
- Jangan menggunakan iframe TradingView.
- Jangan membuat candlestick renderer sendiri jika Lightweight Charts sudah menyediakan fitur tersebut.
- Periksa dependency proyek sebelum melakukan instalasi.

Lightweight Charts merupakan library open-source berlisensi Apache 2.0. Patuhi seluruh persyaratan lisensi, termasuk atribusi TradingView yang sesuai.

## 2. Audit Implementasi Saat Ini

Sebelum melakukan perubahan:

1. Periksa struktur source code proyek.
2. Temukan seluruh file yang berhubungan dengan chart.
3. Identifikasi library chart yang sedang digunakan.
4. Periksa sumber data transaksi dan struktur datanya.
5. Periksa bagaimana data transaksi diubah menjadi OHLC.
6. Periksa mekanisme timeframe, timestamp, sorting, dan rendering.
7. Identifikasi penyebab candlestick saat ini terlihat tidak natural, tidak proporsional, terlalu tipis, atau tidak menyerupai chart trading profesional.

Jangan langsung mengganti seluruh komponen tanpa memahami implementasi sebelumnya.

Setelah audit, lakukan implementasi secara langsung.

## 3. Candlestick Data & OHLC

Gunakan standar OHLC berbasis interval waktu (time-based candlestick).

Timeframe yang harus tersedia:

- 1m
- 5m
- 15m
- 1H
- 4H
- 1D
- 1W

Rumus pembentukan candle:

- Open: harga transaksi pertama dalam interval.
- High: harga tertinggi dalam interval.
- Low: harga terendah dalam interval.
- Close: harga transaksi terakhir dalam interval.

Ketentuan teknis:
- Gunakan timestamp transaksi yang valid.
- Urutkan seluruh transaksi berdasarkan waktu.
- Pastikan setiap candle memiliki timestamp yang benar.
- Pastikan OHLC sesuai dengan data transaksi sebenarnya.
- Pastikan agregasi timeframe menghasilkan data yang konsisten.
- Jangan membuat transaksi, harga, maupun volume palsu.
- Jangan menggunakan random data sebagai pengganti data pasar.
- Tangani interval tanpa transaksi secara konsisten.
- Hindari duplikasi timestamp candle.
- Pastikan candle ditampilkan secara kronologis.
- Perhatikan zona waktu dan batas pergantian interval.

Jika sumber data saat ini memiliki keterbatasan, pertahankan integritas data dan jelaskan keterbatasannya. Jangan mengarang histori harga.

## 4. Desain Visual Candlestick

Saya menginginkan tampilan chart profesional, bersih, dan minimalis.

Referensi visual:
- TradingView
- Binance Spot Trading Chart

### Warna candle

Bullish:
#26A69A

Bearish:
#EF5350

Ketentuan:
- Body candle memiliki proporsi yang natural.
- Wick terlihat jelas dan lebih tipis daripada body.
- Lebar candle konsisten.
- Jarak antarcandle proporsional.
- Hindari candle terlalu tipis atau terlalu gemuk.
- Pastikan candle dengan pergerakan harga kecil tetap terlihat dengan benar.

### Background dan grid

- Gunakan dark charcoal yang menyatu dengan desain KALYTH.
- Grid horizontal dan vertikal sangat halus.
- Hindari garis grid yang terlalu mencolok.
- Price scale ditempatkan di sebelah kanan.
- Time scale ditempatkan di bagian bawah.
- Jangan menggunakan terlalu banyak dekorasi.
- Hindari gradient berlebihan, neon, dan efek visual yang tidak diperlukan.

### Price display

Tampilkan:
- Current price.
- Last price line.
- Label harga terakhir di sisi kanan.
- Format angka harga yang sesuai dengan presisi token KALYTH.
- Perubahan harga jika data yang tersedia mendukungnya.

Jangan menggunakan angka atau persentase dummy.

## 5. Interaksi Chart

Implementasikan fitur berikut:

1. Crosshair horizontal dan vertikal.
2. Tooltip ketika kursor diarahkan ke candle.
3. Informasi OHLC pada candle yang dipilih.
4. Timestamp candle.
5. Zoom in dan zoom out.
6. Drag untuk menggeser chart.
7. Auto-fit price scale.
8. Reset chart view.
9. Responsive resizing.
10. Pergantian timeframe secara langsung.

Informasi OHLC yang ditampilkan:

- O (Open)
- H (High)
- L (Low)
- C (Close)

Pastikan tooltip tidak mengganggu tampilan chart dan mudah dibaca.

## 6. Timeframe Selector

Buat selector timeframe yang sederhana dan profesional.

Urutan:
1m | 5m | 15m | 1H | 4H | 1D | 1W

Ketentuan:
- Timeframe aktif memiliki indikator visual yang jelas.
- Pergantian timeframe harus memperbarui data candle.
- Jangan sekadar mengubah label tanpa mengubah agregasi data.
- Hindari flickering ketika mengganti timeframe.
- Pertahankan posisi chart jika memungkinkan.
- Jangan menampilkan timeframe yang tidak memiliki dukungan data tanpa memberikan penanganan yang sesuai.

## 7. Real-Time Updates

Jika proyek sudah memiliki mekanisme pembaruan transaksi secara berkala:

- Integrasikan Lightweight Charts dengan mekanisme tersebut.
- Gunakan update() untuk memperbarui candle berjalan jika memungkinkan.
- Jangan melakukan setData() secara berulang untuk setiap transaksi.
- Pastikan candle aktif diperbarui tanpa merender ulang seluruh histori.
- Hindari duplikasi candle.
- Hindari update dengan timestamp yang lebih lama daripada data terakhir.
- Pastikan tidak ada memory leak atau event listener yang menumpuk.

Jika belum ada sumber data real-time, jangan membuat simulasi seolah-olah transaksi sungguhan sedang berlangsung.

## 8. Identitas Visual KALYTH

Pertahankan identitas website KALYTH.

Ketentuan:
- Jangan mengubah keseluruhan desain website.
- Jangan mengubah navbar, hero section, token information, maupun komponen lain yang tidak berkaitan.
- Pertahankan layout chart yang sudah ada jika masih relevan.
- Pertahankan warna dan tipografi utama KALYTH.
- Gunakan aksen emas KALYTH hanya untuk elemen pendukung jika sesuai.
- Warna candle tetap hijau dan merah standar trading.
- Hindari desain berlebihan.
- Prioritaskan tampilan yang elegan, profesional, dan mudah dibaca.

Chart harus terlihat seperti bagian dari platform cryptocurrency sungguhan, bukan sekadar grafik dekoratif.

## 9. Responsiveness

Pastikan chart berfungsi dengan baik pada:

- Desktop.
- Laptop.
- Tablet.
- Smartphone.

Ketentuan:
- Chart memenuhi lebar container.
- Tidak terjadi horizontal overflow.
- Price scale tidak terpotong.
- Time scale tetap terbaca.
- Tooltip menyesuaikan ukuran layar.
- Interaksi touch pada smartphone berjalan baik.

## 10. Performa dan Kualitas Kode

- Gunakan implementasi modular.
- Hindari duplikasi fungsi.
- Jangan menambahkan dependency yang tidak diperlukan.
- Hindari penggunaan data dummy.
- Jangan merusak fungsi transaksi yang sudah tersedia.
- Jangan merusak fitur token lainnya.
- Pastikan tidak ada error JavaScript.
- Pastikan tidak ada error pada browser console.
- Pastikan tidak ada dependency yang tidak digunakan.
- Pastikan konfigurasi deployment GitHub Pages tetap berfungsi.

Perhatikan bahwa website KALYTH menggunakan GitHub Pages. Semua perubahan harus kompatibel dengan mekanisme deployment statis yang sudah ada.

## 11. Testing dan Verifikasi

Setelah implementasi, lakukan pengujian:

- Candlestick bullish tampil benar.
- Candlestick bearish tampil benar.
- Wick dan body memiliki proporsi yang tepat.
- OHLC sesuai data transaksi.
- Timeframe menghasilkan agregasi yang benar.
- Timestamp tidak duplikat.
- Chart dapat di-zoom dan digeser.
- Crosshair berfungsi.
- Tooltip menampilkan data yang tepat.
- Current price line sesuai harga terakhir.
- Chart tidak rusak saat browser di-resize.
- Tampilan mobile berfungsi.
- Tidak ada error JavaScript.
- Tidak ada regresi pada fitur website lainnya.

## 12. Instruksi Pengerjaan

Kerjakan langsung pada source code proyek yang sedang terbuka di VS Code.

Jangan hanya memberikan tutorial atau contoh implementasi.

Urutan pekerjaan:

1. Audit source code yang ada.
2. Identifikasi permasalahan chart sebelumnya.
3. Tentukan file yang perlu diperbaiki.
4. Implementasikan TradingView Lightweight Charts v5.x.
5. Perbaiki mekanisme OHLC dan timeframe.
6. Implementasikan desain dan interaksi chart.
7. Jalankan pengujian.
8. Perbaiki seluruh error yang ditemukan.
9. Pastikan deployment GitHub Pages tetap kompatibel.

Jangan menghapus fitur yang sudah berjalan dengan baik.

Jika terdapat keterbatasan pada sumber data, jelaskan secara transparan dan jangan mengakalinya dengan data palsu.

### HASIL AKHIR YANG DIHARAPKAN

Saya menginginkan candlestick chart KALYTH yang:

- Memiliki tampilan setara chart cryptocurrency profesional.
- Menggunakan TradingView Lightweight Charts.
- Memiliki candle yang proporsional dan natural.
- Menggunakan OHLC berbasis waktu yang akurat.
- Mendukung berbagai timeframe.
- Memiliki interaksi chart yang lengkap.
- Responsif di desktop dan smartphone.
- Tetap mempertahankan identitas visual KALYTH.

**Prioritas tertinggi: akurasi data, kualitas visual candlestick, performa, dan pengalaman pengguna.**

Mulai dengan audit source code, kemudian langsung kerjakan implementasinya sampai selesai.