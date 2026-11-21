# ERP Distribusi - Technical Architecture & Business Rules

## 1. Arsitektur Kode & Desain Pola
*   **Framework:** Laravel 11, PHP 8.3, MySQL (InnoDB).
*   **Pola Desain (Design Pattern):**
    *   **Controller:** Hanya untuk menerima *request*, validasi (melalui `FormRequest`), dan mengembalikan respons HTTP/JSON. Dilarang menempatkan logika perhitungan kompleks di sini.
    *   **Service/Action Classes:** Semua logika bisnis utama (Kalkulasi HPP, Validasi 3-Way Matching, Mutasi Stok) wajib diletakkan dalam kelas independen (misal: `App\Services\Inventory\StockMovementService`).
    *   **Background Jobs/Queues:** Operasi berat seperti *generate* invoice massal, tutup buku bulanan, dan *email notification* wajib diproses secara asinkron.

## 2. Aturan Keamanan & Hak Akses (Spatie RBAC)
Setiap *endpoint* API dan *view* harus dilindungi oleh *middleware* peran dan izin yang ketat.
*   **Super Admin:** Akses penuh (MDM, konfigurasi, bypass).
*   **Staf Gudang:** Hanya melihat dan mengubah fisik barang (GR, DO, Stock Opname). DILARANG melihat kolom `cost_price`, `selling_price`, atau *ledger* keuangan.
*   **Admin Sales:** Membuat SO, melihat status ketersediaan barang (`available`), melihat *credit limit*. DILARANG mengubah stok atau HPP.
*   **Purchasing/Procurement:** Membuat PR, PO, mengelola data supplier, dan *update* harga beli.
*   **Finance & Accounting:** Mengelola AR/AP, Invoicing, rekonsiliasi bank, jurnal, dan laporan keuangan.
*   **Manajer/Kepala Cabang:** Sebagai *Approver* (PO di atas limit, *override credit limit* pelanggan) dan melihat *dashboard*.

## 3. Aturan Integritas Data & Basis Data
*   **Database Transactions:** SEMUA proses yang mengubah state lebih dari satu tabel (contoh: proses pengiriman barang yang memotong stok dan membuat tagihan) WAJIB dibungkus dengan `DB::transaction()`.
*   **Tipe Data Finansial:** SEMUA nilai moneter (HPP, Harga Jual, Saldo) WAJIB menggunakan `DECIMAL(15,2)` atau `DECIMAL(19,4)`. HARAM menggunakan FLOAT/DOUBLE.
*   **Soft Deletes & Audit Trail:** SEMUA entitas transaksi (PO, SO, Invoice, GR) wajib menggunakan `SoftDeletes`. Wajib ada pencatatan di tabel `audit_logs` (menggunakan *package* seperti `spatie/laravel-activitylog` atau *custom observer*) untuk perubahan data penting (*old payload* vs *new payload*).
*   **Concurrency Control (Race Condition):** Gunakan `Pessimistic Locking` (`->lockForUpdate()`) pada tabel persediaan dan tabel saldo keuangan saat terjadi transaksi debit/kredit untuk mencegah *over-stock/under-stock* dan *double-spending*.
*   **Idempotency:** *Endpoint* pembayaran (AP/AR) dan mutasi stok wajib dilengkapi mekanisme *idempotency key* untuk menolak pemrosesan ganda akibat gangguan jaringan.

## 4. Aturan Logika Bisnis
*   **Procure-to-Pay (P2P):**
    *   **Workflow:** Purchase Requisition (PR) -> Purchase Order (PO) [Pending Approval jika > Rp10 Juta] -> PO Approved (Budget Lock) -> Goods Receipt (GR) -> Purchase Invoice (AP).
    *   **3-Way Matching:** Pembayaran AP DITOLAK jika kuantitas/harga di PO, GR, dan Invoice tidak sama. Jika penerimaan parsial, AP dibuat hanya untuk barang yang diterima fisik.
*   **Manajemen Persediaan:**
    *   **State Barang (Level Batch):** `Available`, `Reserved` (Terkunci SO), `In-Transit`, `In-QC/Quarantined`.
    *   **FEFO (First Expired, First Out):** Pengambilan barang oleh staf gudang otomatis ditentukan oleh sistem berdasarkan `expiry_date` terdekat dari tabel *batch*.
    *   **Immutable Stock Ledger:** DILARANG mengubah (*update*) angka stok langsung. Semua perubahan harus masuk sebagai entri debit/kredit baru di tabel `stock_movements`.
    *   **Valuasi Otomatis:** HPP menggunakan sistem *Moving Weighted Average* yang dihitung ulang saat GR divalidasi. Memicu *event* akuntansi secara *real-time*.