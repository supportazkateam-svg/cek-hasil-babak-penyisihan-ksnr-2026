// api/cari.js
const fs = require('fs');
const path = require('path');

// Kunci rahasia untuk panitia tes sebelum switch di-ON-kan
const SECRET_TEST_KEY = 'panitiaksnr2026';
const MAX_LIMIT = 50;

let DATA_PESERTA = null;

// ==========================================
// FUNGSI CEK SAKLAR ON / OFF
// ==========================================
function getSwitchStatus() {
  // 1. Cek dari Environment Variable Vercel terlebih dahulu (jika ada)
  if (process.env.STATUS_RILIS !== undefined) {
    return process.env.STATUS_RILIS === 'true' || process.env.STATUS_RILIS === '1';
  }

  // 2. Jika tidak ada, cek dari file config.json
  const configPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return Boolean(config.is_active);
    } catch (e) {
      console.error('[Config Error]:', e.message);
    }
  }

  // Default jika file belum dibuat: OFF (terkunci)
  return false;
}

// ==========================================
// MEMUAT DATA PESERTA
// ==========================================
function loadPesertaData() {
  if (DATA_PESERTA) return DATA_PESERTA;

  const possiblePaths = [
    path.join(process.cwd(), 'peserta.json'),
    path.join(process.cwd(), 'data-peserta.json'),
    path.join(process.cwd(), 'data', 'peserta.json')
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(rawContent);
        DATA_PESERTA = Array.isArray(parsed) ? parsed : (parsed.data || []);
        return DATA_PESERTA;
      } catch (err) {
        console.error(`[Error JSON] ${filePath}:`, err.message);
      }
    }
  }

  DATA_PESERTA = [];
  return DATA_PESERTA;
}

function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================
// MAIN HANDLER
// ==========================================
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { mode = 'nama', q = '', test_key = '', check_status = 'false' } = req.query;
    
    // Cek saklar sistem saat ini (true = ON, false = OFF)
    const isSystemOn = getSwitchStatus();
    const isTesting = test_key === SECRET_TEST_KEY;

    // JIKA FRONTEND HANYA CEK STATUS SAKLAR (Saat pertama buka halaman)
    if (check_status === 'true') {
      return res.status(200).json({
        success: true,
        is_active: isSystemOn,
        is_test_mode: isTesting
      });
    }

    // PROTEKSI SAKLAR: Jika OFF dan bukan mode tes panitia
    if (!isSystemOn && !isTesting) {
      return res.status(403).json({
        success: false,
        status: 'locked',
        message: 'Pengumuman hasil belum dibuka oleh panitia. Silakan pantau halaman ini secara berkala.'
      });
    }

    // VALIDASI INPUT PENCARIAN
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
        message: 'Input mengandung karakter yang tidak valid.'
      });
    }

    const daftarPeserta = loadPesertaData();
    if (!daftarPeserta || daftarPeserta.length === 0) {
      return res.status(500).json({
        success: false,
        status: 'data_unavailable',
        message: 'Database peserta belum tersedia.'
      });
    }

    const queryNorm = normalizeText(rawQuery);
    let hasil = [];

    if (mode === 'sekolah') {
      hasil = daftarPeserta.filter(p => {
        const sekolahNorm = normalizeText(p.sekolah);
        const isLolos = String(p.status || '').toUpperCase() === 'LOLOS';
        return sekolahNorm.includes(queryNorm) && isLolos;
      });
      hasil.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
    } else {
      hasil = daftarPeserta.filter(p => normalizeText(p.nama).includes(queryNorm));
      hasil.sort((a, b) => {
        const aLolos = String(a.status || '').toUpperCase() === 'LOLOS';
        const bLolos = String(b.status || '').toUpperCase() === 'LOLOS';
        if (aLolos && !bLolos) return -1;
        if (!aLolos && bLolos) return 1;
        return String(a.nama || '').localeCompare(String(b.nama || ''));
      });
    }

    return res.status(200).json({
      success: true,
      status: 'success',
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
