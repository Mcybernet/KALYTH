# PRODUCT REQUIREMENTS DOCUMENT (PRD)
# KALYTH — BONDING CURVE ECOSYSTEM

**Project:** KALYTH (KLYTH)  
**Version:** 2.0  
**Network:** Solana Devnet  
**Token Standard:** Classic SPL Token  
**Smart Contract Framework:** Anchor / Rust  
**Frontend:** KALYTH Website  
**Development Approach:** Devnet-first

---

# 1. PROJECT OVERVIEW

## 1.1 Description

KALYTH (KLYTH) adalah proyek ekosistem token berbasis Solana yang menggunakan mekanisme Linear Bonding Curve untuk menentukan harga pembelian dan penjualan token secara otomatis, dengan pembakaran otomatis harian dari burn reserve.

Pengguna dapat melakukan:
- Membeli KLYTH menggunakan SOL.
- Menjual KLYTH dan menerima SOL.
- Melihat perubahan harga berdasarkan aktivitas transaksi.
- Melihat jumlah token yang beredar.
- Melihat saldo SOL Reserve.
- Melihat aktivitas transaksi.
- Melihat riwayat pembakaran token (burn).

Seluruh transaksi Buy dan Sell harus diproses melalui Solana Program yang berjalan secara on-chain.

Website berfungsi sebagai antarmuka pengguna untuk berinteraksi dengan smart contract.

## 1.2 Main Objectives

1. Membuat mekanisme Bonding Curve yang berjalan di Solana Devnet.
2. Mengimplementasikan pembelian dan penjualan KLYTH.
3. Mengelola SOL Reserve secara aman.
4. Mengelola Token Vault untuk persediaan KLYTH.
5. Menghubungkan website dengan Phantom Wallet.
6. Menampilkan data blockchain secara aktual.
7. Menyediakan mekanisme burn yang transparan.
8. Memastikan seluruh transaksi dapat diverifikasi melalui Solana Explorer.

## 1.3 Development Principles

- Devnet only.
- Tidak menggunakan uang sungguhan.
- Tidak menggunakan simulasi untuk transaksi yang diklaim berhasil.
- Semua transaksi Buy dan Sell wajib on-chain.
- Tidak boleh mengarang saldo atau riwayat transaksi.
- Keamanan smart contract menjadi prioritas.
- Implementasi harus dilakukan bertahap dan dapat diuji.

---

# 2. TOKEN CONFIGURATION

Mint baru KALYTH dibuat pada Devnet setelah mint lama ditinggalkan. Program
bonding curve bersifat mint-agnostic, jadi program ID tidak berubah.

| Parameter | Value |
|---|---|
| Token Name | KALYTH |
| Symbol | KLYTH |
| Network | Solana Devnet |
| Token Standard | Classic SPL Token |
| Decimals | 6 |
| Initial Supply | 100,000,000 KLYTH |
| Final Supply (setelah 50 burn) | 60,000,000 KLYTH |
| Mint Address | GuaBwGkmwKJqU5AkxCoFQdGqY1UsDGtswJ9KGphvhkeK |
| Main Wallet | 2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN |
| Burn Authority (PDA) | FuRgsStULTV2enAXEkAv9NYypxbv6Vcp6vXo2nWh7rN9 |
| Burn Reserve Token Account | V6yBiGHso17rfhD8qVCiJqHdSVAfPL5QWfp3EKevJzG |

Alokasi:

| Alokasi | Jumlah | Keterangan |
|---|---|---|
| Bonding curve | 50,000,000 KLYTH | Dijual melalui curve |
| Burn reserve | 40,000,000 KLYTH | Dibakar otomatis 800,000/hari selama 50 hari |
| Treasury | 5,000,000 KLYTH | Operasional proyek |
| Community | 5,000,000 KLYTH | Komunitas |

Important:
- Mint authority dicabut setelah alokasi awal; supply tidak bisa ditambah.
- Burn reserve dimiliki oleh PDA, bukan wallet. Tidak ada private key yang bisa hilang.
- Pembakaran hanya bisa dilakukan oleh instruksi `burn_daily` dengan cap harian dan jeda 23j50m.
- Jangan mengubah upgrade authority tanpa persetujuan.
- Verifikasi seluruh alamat dan saldo melalui Devnet RPC sebelum melakukan transaksi.

Snapshot saat rebuild:
- Treasury ATA: 5,000,000 KLYTH.
- Community account: 5,000,000 KLYTH.
- Curve vault: 50,000,000 KLYTH.
- Burn reserve: 40,000,000 KLYTH.
- Total supply: 100,000,000 KLYTH.
- SOL reserve: 2 SOL.

Angka di atas adalah snapshot saat rebuild, bukan sumber data live.

---

# 3. SYSTEM ARCHITECTURE

Sistem terdiri dari tiga komponen utama.

## 3.1 Frontend

Frontend merupakan website KALYTH yang menyediakan:
- Overview Dashboard.
- Bonding Curve.
- Buy KLYTH.
- Sell KLYTH.
- Tokenomics.
- Burn Tracker.
- Transaction History.
- Wallet Connection.

Teknologi yang dapat digunakan:
- HTML.
- CSS.
- JavaScript atau TypeScript.
- Framework frontend yang sudah digunakan proyek.
- Solana Wallet Adapter.

Pertahankan identitas visual website KALYTH yang sudah tersedia.

## 3.2 Solana Program

Smart contract menggunakan:
- Rust.
- Anchor Framework.
- Solana Program Library.
- Classic SPL Token Program.

Program bertanggung jawab atas:
- Inisialisasi bonding curve.
- Pengelolaan konfigurasi.
- Pengelolaan Token Vault.
- Pengelolaan SOL Reserve.
- Perhitungan harga.
- Buy.
- Sell.
- Validasi transaksi.
- Pengelolaan biaya transaksi jika diaktifkan.

## 3.3 Blockchain Integration

Gunakan Solana Devnet RPC.

Semua data penting harus berasal dari blockchain:
- Token supply.
- Token Vault balance.
- SOL Reserve balance.
- Harga bonding curve.
- Status transaksi.
- Transaction signatures.

Jangan menggunakan nilai statis sebagai data live.

---

# 4. BONDING CURVE MECHANISM

## 4.1 Curve Type

Gunakan Linear Bonding Curve.

Harga marginal token ditentukan oleh:

P(x) = P0 + kx

Keterangan:
- P(x): Harga marginal KLYTH.
- P0: Harga awal.
- k: Kemiringan kurva.
- x: Jumlah bersih token yang sudah terjual melalui bonding curve.

## 4.2 Initial Model Parameters

Gunakan parameter berikut sebagai konfigurasi awal untuk pengujian.

| Parameter | Value |
|---|---:|
| Initial Price (P0) | 0.000001 SOL/KLYTH |
| Slope (k) | 0.00000000000008 SOL/KLYTH² |
| Maximum Sold Supply | 50,000,000 KLYTH |
| Curve Type | Linear |
| Network | Devnet |

Parameter tersebut merupakan nilai awal model dan harus dapat dikonfigurasi saat inisialisasi program.

Jangan menganggap nilai tersebut sudah final untuk produksi.

## 4.3 Integral Pricing

Harga pembelian dan penjualan harus dihitung menggunakan integral kurva.

Biaya untuk membeli token dari supply x ke x + q:

Cost = P0 × q + (k / 2) × ((x + q)² - x²)

Nilai SOL yang dibayarkan harus dihitung berdasarkan perubahan posisi pada kurva.

Penjualan harus menggunakan perhitungan terbalik dari kurva:

Return = Integral(x - q, x)

Jangan menggunakan harga marginal saat ini dikalikan jumlah token sebagai pengganti integral.

## 4.4 Important Calculation Requirements

- Gunakan integer arithmetic.
- Gunakan satuan lamports untuk SOL.
- Gunakan satuan terkecil token untuk KLYTH (6 decimals).
- Jangan menggunakan floating-point arithmetic untuk transaksi on-chain.
- Tentukan skala fixed-point secara konsisten.
- Gunakan checked arithmetic.
- Cegah overflow dan underflow.
- Pembulatan harus konservatif dan terdokumentasi.
- Pastikan hasil Buy dan Sell konsisten.

Buat unit test untuk semua fungsi perhitungan.

---

# 5. BUY KLYTH

## 5.1 User Flow

1. Pengguna membuka halaman Bonding Curve.
2. Pengguna menghubungkan Phantom Wallet.
3. Website membaca saldo SOL pengguna.
4. Pengguna memasukkan jumlah SOL atau KLYTH yang ingin dibeli.
5. Website menampilkan estimasi KLYTH yang akan diterima.
6. Website menampilkan harga, biaya, dan slippage.
7. Pengguna mengonfirmasi transaksi.
8. Phantom meminta persetujuan.
9. Transaksi dikirim ke Solana Devnet.
10. Program memvalidasi transaksi.
11. Program menerima SOL.
12. Program mengirim KLYTH dari Token Vault ke pengguna.
13. Website menampilkan hasil transaksi.

## 5.2 Buy Requirements

Program harus:
- Memastikan bonding curve telah diinisialisasi.
- Memastikan Token Vault memiliki saldo cukup.
- Memastikan jumlah pembelian valid.
- Memastikan batas maksimum supply tidak terlampaui.
- Menghitung harga berdasarkan integral kurva.
- Memeriksa minimum output atau batas slippage.
- Memastikan pengguna memiliki SOL cukup.
- Memastikan transaksi menggunakan akun dan mint yang benar.

## 5.3 Buy Parameters

Transaksi harus memiliki parameter:
- Amount atau jumlah pembelian.
- Minimum KLYTH received.
- Batas slippage.
- Wallet pengguna.

Gunakan pendekatan slippage protection agar pengguna tidak menerima jumlah token di bawah batas yang mereka setujui.

---

# 6. SELL KLYTH

## 6.1 User Flow

1. Pengguna membuka halaman Sell.
2. Wallet sudah terhubung.
3. Website membaca saldo KLYTH pengguna.
4. Pengguna memasukkan jumlah KLYTH yang akan dijual.
5. Website menampilkan estimasi SOL yang diterima.
6. Website menampilkan harga dan biaya.
7. Pengguna mengonfirmasi transaksi.
8. Phantom meminta persetujuan.
9. Transaksi dikirim ke Devnet.
10. Program memvalidasi saldo dan akun.
11. Program mengambil KLYTH dari pengguna.
12. Program mengirim SOL dari SOL Reserve.
13. Website menampilkan hasil transaksi.

## 6.2 Sell Requirements

Program harus:
- Memastikan pengguna memiliki KLYTH cukup.
- Memastikan SOL Reserve mencukupi.
- Menghitung pengembalian berdasarkan integral kurva.
- Memastikan jumlah penjualan tidak melebihi jumlah token yang telah terjual.
- Memeriksa minimum SOL received.
- Memvalidasi token mint dan token account.
- Menolak transaksi jika reserve tidak mencukupi.

Jangan mengirim SOL jika transfer KLYTH gagal.

Seluruh operasi harus berlangsung secara atomik dalam satu transaksi Solana.

---

# 7. TOKEN VAULT

Token Vault menyimpan persediaan KLYTH yang disediakan untuk bonding curve.

Requirements:

- Gunakan Classic SPL Token Program.
- Vault harus dikendalikan oleh PDA program.
- Program harus memiliki otoritas yang tepat untuk mentransfer token.
- Validasi mint KLYTH.
- Validasi pemilik dan alamat token account.
- Jangan menggunakan wallet pribadi sebagai otoritas transaksi harian tanpa alasan teknis yang kuat.
- Jangan mengirim seluruh Treasury ke Vault secara otomatis.

Vault harus didanai secara eksplisit melalui instruksi deposit yang tervalidasi.

Program tidak boleh mencetak KLYTH baru untuk setiap transaksi Buy.

---

# 8. SOL RESERVE

SOL Reserve menyimpan SOL yang diterima dari pembelian KLYTH.

Requirements:

- Gunakan PDA sebagai pengendali reserve jika sesuai dengan desain program.
- SOL Reserve harus dapat menerima SOL.
- Sell hanya boleh dibayar dari reserve yang tersedia.
- Program harus mempertahankan rent-exempt minimum jika akun membutuhkan rent exemption.
- Jangan menganggap saldo seluruh akun program dapat dibelanjakan.
- Gunakan checked arithmetic untuk seluruh perhitungan saldo.
- Cegah penarikan SOL yang tidak sah.

Buat instruksi administrasi untuk memeriksa saldo reserve.

Jangan membuat instruksi withdrawal bebas yang dapat menguras reserve.

---

# 9. BURN MECHANISM

KLYTH memiliki mekanisme burn otomatis yang terpisah dari Buy dan Sell.

Persyaratan:
- Burn dilakukan menggunakan Classic SPL Token Program.
- Burn reserve (40,000,000 KLYTH) dimiliki oleh `burn_authority` PDA, bukan wallet.
- Instruksi `burn_daily` bersifat permissionless dan membakar `min(daily_cap, reserve)`.
- Cap harian adalah 800,000 KLYTH; jeda minimum 23 jam 50 menit.
- Setelah 50 burn, supply turun dari 100,000,000 menjadi 60,000,000 KLYTH.
- Burn mengurangi total supply dan dapat diverifikasi melalui transaction signature.
- Riwayat burn ditampilkan di Burn Tracker.
- Jangan menganggap transfer token ke wallet tertentu sebagai burn permanen.

Crank eksternal (GitHub Actions atau Task Scheduler) hanya membayar fee; ia tidak
bisa memilih jumlah, tujuan, atau waktu di luar window on-chain.

Jangan meminta atau menyimpan private key dalam frontend.

---

# 10. WALLET INTEGRATION

Gunakan Solana Wallet Adapter yang kompatibel dengan Phantom.

Requirements:

- Connect Wallet.
- Disconnect Wallet.
- Menampilkan alamat wallet.
- Membaca saldo SOL.
- Membaca saldo KLYTH.
- Membuat transaksi.
- Meminta persetujuan wallet.
- Mengirim transaksi.
- Membaca status transaksi.
- Menampilkan transaction signature.

Wallet harus menggunakan Solana Devnet.

Jangan pernah:
- Meminta seed phrase pengguna.
- Meminta private key pengguna.
- Menyimpan private key dalam local storage.
- Mengirim private key ke backend.
- Meminta pengguna menyalin secret key ke website.

---

# 11. WEBSITE FEATURES

## 11.1 Overview

Menampilkan:
- Total Supply.
- Circulating Supply jika dapat dihitung secara akurat.
- KLYTH Price.
- SOL Reserve.
- Token Vault Balance.
- Total Burned.
- Bonding Curve Progress.
- Recent Transactions.

## 11.2 Bonding Curve

Menampilkan:
- Grafik kurva.
- Harga marginal saat ini.
- Jumlah token terjual.
- Progress curve.
- Estimasi Buy.
- Estimasi Sell.
- Slippage.
- Buy KLYTH.
- Sell KLYTH.

## 11.3 Tokenomics

Menampilkan:
- Token Name.
- Symbol.
- Decimals.
- Mint Address.
- Total Supply.
- Treasury.
- Bonding Curve Vault.
- Burn Reserve.
- Total Burned.

## 11.4 Burn Tracker

Menampilkan:
- Total KLYTH burned.
- Riwayat burn.
- Jumlah burn per transaksi.
- Transaction signature.
- Solana Explorer link.

## 11.5 Activity

Menampilkan:
- Buy transactions.
- Sell transactions.
- Burn transactions.
- Timestamp.
- Wallet address.
- Amount.
- Transaction status.

Jangan menampilkan data palsu sebagai transaksi blockchain.

---

# 12. SECURITY REQUIREMENTS

Keamanan merupakan prioritas utama.

Implementasikan:
- Account validation.
- PDA validation.
- Token mint validation.
- Token authority validation.
- Checked arithmetic.
- Slippage protection.
- Minimum output protection.
- Reserve balance validation.
- Maximum supply validation.
- Reentrancy-aware account handling sesuai model eksekusi Solana.
- Atomic transaction handling.
- Error handling.
- Access control untuk instruksi administratif.

Jangan memberikan akses administratif kepada wallet publik.

Jangan menyediakan fungsi yang dapat menguras SOL Reserve atau mengambil token pengguna tanpa persetujuan transaksi.

Semua instruksi administratif harus memiliki otorisasi eksplisit.

Jangan melakukan deployment ke Mainnet.

---

# 13. TESTING REQUIREMENTS

Sebelum deployment Devnet, buat pengujian untuk:

## Bonding Curve Calculation
- Harga awal.
- Harga setelah pembelian.
- Harga setelah penjualan.
- Integral pembelian.
- Integral penjualan.
- Pembulatan.
- Overflow.
- Underflow.

## Buy
- Buy berhasil.
- Saldo SOL tidak cukup.
- Token Vault tidak cukup.
- Slippage terlampaui.
- Melebihi batas maksimum supply.
- Jumlah pembelian nol.

## Sell
- Sell berhasil.
- Saldo KLYTH tidak cukup.
- SOL Reserve tidak cukup.
- Slippage terlampaui.
- Menjual melebihi jumlah token yang terjual.
- Jumlah penjualan nol.

## Security
- Wallet tidak berwenang.
- Mint salah.
- Token Vault salah.
- PDA salah.
- Akun reserve salah.
- Transaksi gagal tidak boleh mengubah saldo sebagian.

## Integration
- Connect Phantom.
- Buy dari frontend.
- Sell dari frontend.
- Memeriksa transaction signature.
- Membaca saldo setelah transaksi.
- Memastikan dashboard mengikuti data on-chain.

---

# 14. DEVELOPMENT PHASES

Implementasikan proyek secara bertahap.

## Phase 1 — Environment Setup
- Periksa Rust.
- Periksa Solana CLI.
- Periksa Anchor.
- Periksa Node.js.
- Konfigurasi Devnet.
- Verifikasi token KLYTH yang sudah ada.

## Phase 2 — Smart Contract Foundation
- Membuat Anchor project.
- Membuat state bonding curve.
- Membuat PDA.
- Membuat konfigurasi.
- Membuat Token Vault.
- Membuat SOL Reserve.

## Phase 3 — Bonding Curve Logic
- Implementasi fixed-point arithmetic.
- Implementasi integral.
- Unit testing.
- Validasi batas maksimum supply.

## Phase 4 — Buy Instruction
- Implementasi Buy.
- Validasi token vault.
- Validasi pembayaran.
- Pengujian transaksi.

## Phase 5 — Sell Instruction
- Implementasi Sell.
- Validasi token pengguna.
- Validasi SOL Reserve.
- Pengujian transaksi.

## Phase 6 — Devnet Deployment
- Build program.
- Jalankan test.
- Deploy ke Devnet.
- Simpan Program ID.
- Inisialisasi state.
- Verifikasi akun PDA.

## Phase 7 — Frontend Integration
- Integrasi Wallet Adapter.
- Integrasi Buy.
- Integrasi Sell.
- Menampilkan hasil transaksi.
- Membaca data on-chain.

## Phase 8 — Dashboard Integration
- Live token metrics.
- Curve visualization.
- Activity history.
- Burn tracker.
- Explorer links.

## Phase 9 — Final Testing
- Uji transaksi end-to-end.
- Uji skenario kegagalan.
- Uji keamanan.
- Dokumentasi deployment.

---

# 15. PROJECT STRUCTURE

Struktur berikut merupakan target awal. AI coding assistant boleh menyesuaikan setelah memeriksa repository yang sudah ada.

```text
nebula-reserve/
│
├── programs/
│   └── nebula_curve/
│       └── src/
│           ├── lib.rs
│           ├── state.rs
│           ├── errors.rs
│           ├── instructions/
│           │   ├── initialize.rs
│           │   ├── buy.rs
│           │   ├── sell.rs
│           │   ├── deposit.rs
│           │   └── admin.rs
│           └── math/
│               └── curve.rs
│
├── tests/
│   └── nebula_curve.ts
│
├── app/
│   └── frontend/
│
├── scripts/
│   ├── deploy.ts
│   └── initialize.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   └── DEPLOYMENT.md
│
├── Anchor.toml
├── Cargo.toml
├── package.json
└── README.md
```

Jangan merusak atau menghapus website KALYTH yang sudah tersedia.

Periksa struktur repository terlebih dahulu sebelum menentukan lokasi implementasi frontend.

---

# 16. IMPORTANT DEVELOPMENT RULES FOR AI CODING AGENT

Ikuti aturan berikut selama pengembangan:

1. Jangan membuat seluruh proyek sekaligus tanpa tahapan.
2. Periksa repository sebelum mengubah file.
3. Jangan menghapus kode yang sudah berfungsi tanpa alasan.
4. Jangan membuat token mint baru.
5. Jangan mengubah konfigurasi token KLYTH tanpa persetujuan.
6. Jangan menggunakan Mainnet.
7. Jangan melakukan transaksi finansial sungguhan.
8. Jangan mengarang Program ID atau transaction signature.
9. Jangan menampilkan simulasi sebagai transaksi berhasil.
10. Jangan menyimpan private key di frontend atau repository.
11. Jangan menggunakan floating-point arithmetic dalam perhitungan on-chain.
12. Jangan melakukan deployment sebelum seluruh test berhasil.
13. Jelaskan setiap perubahan file.
14. Berikan perintah terminal yang dapat dijalankan.
15. Berikan hasil test dan error secara transparan.
16. Jika ada keputusan ekonomi atau keamanan yang belum jelas, tanyakan sebelum implementasi.
17. Jangan mengubah nilai parameter bonding curve secara diam-diam.
18. Jangan memindahkan token Treasury ke Vault tanpa persetujuan.
19. Jangan mengaktifkan burn otomatis tanpa persetujuan.
20. Kerjakan satu phase pada satu waktu.

---

# 17. ACCEPTANCE CRITERIA

Proyek dinyatakan berhasil apabila:

- [x] Program Anchor berhasil dibangun.
- [x] Bonding Curve state berhasil diinisialisasi.
- [x] Token Vault berhasil dibuat dan divalidasi.
- [x] SOL Reserve berfungsi.
- [x] Perhitungan harga lulus unit test.
- [x] Buy KLYTH berhasil di Devnet.
- [x] Sell KLYTH berhasil di Devnet.
- [x] Slippage protection bekerja.
- [ ] Transaksi gagal tidak mengubah saldo secara parsial.
- [x] Phantom Wallet berhasil terhubung.
- [x] Frontend dapat mengirim transaksi.
- [x] Dashboard membaca data on-chain.
- [x] Riwayat transaksi dapat diverifikasi.
- [x] Burn Tracker membaca data burn yang valid.
- [x] Tidak ada private key yang terekspos.
- [x] Semua transaksi dapat diverifikasi melalui Solana Explorer.

---

# 18. FIRST TASK — START DEVELOPMENT

Jangan langsung mengimplementasikan seluruh PRD.

Mulai dengan Phase 1 saja.

Tugas pertama AI coding assistant:

1. Periksa kondisi sistem pengembangan.
2. Periksa struktur repository VS Code.
3. Identifikasi teknologi website yang sudah digunakan.
4. Periksa instalasi Rust, Cargo, Solana CLI, Anchor, Node.js, dan npm.
5. Periksa konfigurasi Solana Devnet.
6. Verifikasi apakah mint KLYTH yang sudah ada dapat dibaca melalui Devnet RPC.
7. Buat laporan kesiapan pengembangan.

Jangan melakukan deployment, transfer token, burn, atau perubahan authority pada tahap ini.

Setelah Phase 1 selesai, tampilkan:
- Komponen yang sudah tersedia.
- Komponen yang belum tersedia.
- Masalah yang ditemukan.
- Perintah untuk memperbaikinya.
- Rencana Phase 2.

**Berhenti setelah Phase 1. Tunggu persetujuan pengguna sebelum melanjutkan.**

---

**END OF PRD**