// api/cari.js
const fs = require('fs');
const path = require('path');

// Kunci rahasia untuk panitia melakukan tes sebelum saklar di-ON-kan
const SECRET_TEST_KEY = 'panitiaksnr2026';

// Batas maksimal hasil pencarian yang dikembalikan (demi performa & keamanan)
const MAX_LIMIT = 50;

// Cache data peserta di memori agar cepat
let DATA_PESERTA = null;

// ==========================================
// 1. FUNGSI CEK SAKLAR ON / OFF
// ==========================================
function getSwitchStatus() {
  // Opsi A: Cek dari Environment Variable Vercel terlebih dahulu (jika ada)
  if (process.env.STATUS_RILIS !== undefined) {
    return process.env.STATUS_RILIS === 'true' || process.env.STATUS_RILIS === '1';
  }

  // Opsi B: Cek dari file config.json (mencari di root proyek)
  const possibleConfigs = [
    path.join(__dirname, '..', 'config.json'), // Naik 1 level dari folder api/ ke root
    path.join(process.cwd(), 'config.json'),   // Root working directory
    path.join(__dirname, 'config.json')        // Cadangan jika ditaruh di dalam api/
  ];

  for (const configPath of possibleConfigs) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return Boolean(config.is_active);
      } catch (e) {
        console.error('[Config Error]:', e.message);
      }
    }
  }

  // Default jika file belum terbaca: OFF (terkunci)
  return false;
}

// ==========================================
// 2. FUNGSI MEMUAT DATA PESERTA
// ==========================================
function loadPesertaData() {
  if (DATA_PESERTA) return DATA_PESERTA;

  // Jalur pencarian file peserta.json (diutamakan di dalam folder api/)
  const possiblePaths = [
    path.join(__dirname, 'peserta.json'),           // 1. Tepat berdampingan dengan cari.js di folder api/
    path.join(process.cwd(), 'api', 'peserta.json'),// 2. Jalur absolut dari root ke api/peserta.json
    path.join(process.cwd(), 'peserta.json'),       // 3. Cadangan di root
    path.join(process.cwd(), 'data', 'peserta.json')// 4. Cadangan di folder data/
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(rawContent);
        DATA_PESERTA = Array.isArray(parsed) ? parsed : (parsed.data || []);
        console.log(`[Success] Berhasil memuat ${DATA_PESERTA.length} peserta dari: ${filePath}`);
        return DATA_PESERTA;
      } catch (err) {
        console.error(`[Error JSON] Gagal membaca ${filePath}:`, err.message);
      }
    }
  }

  DATA_PESERTA = [];
  return DATA_PESERTA;
}

// ==========================================
// 3. FUNGSI NORMALISASI TEKS
// ==========================================
function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================
// 4. MAIN HANDLER (SERVERLESS FUNCTION)
// ==========================================
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Hanya izinkan HTTP GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      success: false,
      message: 'Method Not Allowed. Hanya mendukung GET.'
    });
  }

  try {
    const { mode = 'nama', q = '', test_key = '', check_status = 'false' } = req.query;

    const isSystemOn = getSwitchStatus();
    const isTesting = test_key === SECRET_TEST_KEY;

    // --- FITUR 1: FRONTEND HANYA CEK SAKLAR SAAT BUKA HALAMAN ---
    if (check_status === 'true') {
      return res.status(200).json({
        success: true,
        is_active: isSystemOn,
        is_test_mode: isTesting
      });
    }

    // --- FITUR 2: PROTEKSI SAKLAR ---
    if (!isSystemOn && !isTesting) {
      return res.status(403).json({
        success: false,
        status: 'locked',
        message: 'Pengumuman hasil belum dibuka oleh panitia. Silakan pantau halaman ini secara berkala.'
      });
    }

    // --- FITUR 3: VALIDASI INPUT ---
    const rawQuery = String(q).trim();
    if (rawQuery.length < 2) {
      return res.status(400).json({
        success: false,
        status: 'invalid_query',
        message: mode === 'nama'
          ? 'Masukkan minimal 2 karakter nama peserta.'
          : 'Masukkan minimal 2 karakter nama sekolah.'
      });
    }

    if (/[<>{}[\]\\]/.test(rawQuery)) {
      return res.status(400).json({
        success: false,
        status: 'invalid_characters',
        message: 'Input mengandung karakter yang tidak diperbolehkan.'
      });
    }

    // Muat data peserta
    const daftarPeserta = loadPesertaData();
    if (!daftarPeserta || daftarPeserta.length === 0) {
      return res.status(500).json({
        success: false,
        status: 'data_unavailable',
        message: 'Database peserta belum tersedia di server.'
      });
    }

    const queryNorm = normalizeText(rawQuery);
    let hasil = [];

    // --- FITUR 4: PROSES PENCARIAN & SORTING ---
    if (mode === 'sekolah') {
      // Mode Sekolah: hanya tampilkan peserta yang LOLOS
      hasil = daftarPeserta.filter(p => {
        const sekolahNorm = normalizeText(p.sekolah);
        const isLolos = String(p.status || '').toUpperCase() === 'LOLOS';
        return sekolahNorm.includes(queryNorm) && isLolos;
      });

      // Urutkan alfabetis nama peserta
      hasil.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
    } else {
      // Mode Nama: tampilkan semua yang cocok, prioritas LOLOS di urutan atas
      hasil = daftarPeserta.filter(p => {
        const namaNorm = normalizeText(p.nama);
        return namaNorm.includes(queryNorm);
      });

      hasil.sort((a, b) => {
        const aLolos = String(a.status || '').toUpperCase() === 'LOLOS';
        const bLolos = String(b.status || '').toUpperCase() === 'LOLOS';
        if (aLolos && !bLolos) return -1;
        if (!aLolos && bLolos) return 1;
        return String(a.nama || '').localeCompare(String(b.nama || ''));
      });
    }

    // Batasi output data maksimal 50 baris
    return res.status(200).json({
      success: true,
      status: 'success',
      mode: mode,
      query: rawQuery,
      total_found: hasil.length,
      data: hasil.slice(0, MAX_LIMIT)
    });

  } catch (err) {
    console.error('[API Error]:', err);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kendala teknis pada server.'
    });
  }
};
