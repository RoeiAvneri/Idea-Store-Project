// server.js

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

// ─── Supabase/Postgres Setup ───────────────────────────────────────────────────

import postgres from 'postgres';
import 'dotenv/config';

// Ensure DATABASE_URL is defined
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌  Missing DATABASE_URL environment variable");
  process.exit(1);
}

let sql;
try {
  // Use the WHATWG URL parser to extract username, password, host, port, database name
  const dbUrl = new URL(DATABASE_URL);
  
  sql = postgres({
    host: dbUrl.hostname,                 // e.g. "db.oetfjwasgtydkckxpzoy.supabase.co"
    port:   Number(dbUrl.port),           // e.g. 5432
    database: dbUrl.pathname.slice(1),    // e.g. "postgres"
    username: dbUrl.username,             // e.g. "postgres"
    password: dbUrl.password,             // your DB password
    ssl: {
      rejectUnauthorized: false           // Supabase requires SSL
    }
  });
} catch (err) {
  console.error("❌ Failed to parse or connect with DATABASE_URL:", err);
  process.exit(1);
}

// Create the "entries" table if it doesn’t already exist
await sql`
  CREATE TABLE IF NOT EXISTS entries (
    id            BIGSERIAL PRIMARY KEY,
    filename      TEXT        NOT NULL,            -- Google Drive File ID
    gdrive_filename TEXT      NULL,                -- Original .gz filename
    title         TEXT        NULL,
    tags          TEXT        NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );
`;

// ─── Express App Setup ────────────────────────────────────────────────────────

const app = express();

// CORS configuration
const corsOptions = {
  origin: [
    'https://roeiavneri.github.io',          // Your GitHub Pages origin
    'http://localhost:3000',
    'https://idea-store-project.onrender.com',
    'http://127.0.0.1:3000',
    'http://localhost:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Entry-Title']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Preflight

// Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.text({ type: 'text/plain' }));
app.use(bodyParser.text({ type: '*/*' }));

// Static files
app.use(express.static(path.join(process.cwd(), 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'), err => {
    if (err) {
      console.error("Error sending index.html:", err);
      res.status(err.status || 500).send("Error loading page or Page not found");
    }
  });
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

function generateOriginalFilename() {
  return `entry-${Date.now()}.gz`;
}

function extractTitle(content) {
  if (!content || typeof content !== 'string') return 'Untitled';
  const lines = content.split('\n');
  const firstLine = lines[0] || '';
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
}

// Google Drive helpers (unchanged)
import {
  uploadFileToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
  updateFileInDrive
} from './GDriveHelper.js';

// ─── API Routes ───────────────────────────────────────────────────────────────

// POST /save — compress + upload to Drive + insert into Postgres
app.post('/save', async (req, res) => {
  try {
    let rawText = req.body;
    if (typeof rawText === 'object') rawText = JSON.stringify(rawText);

    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid input' });
    }

    // 1) Create compressed .gz in /tmp
    const originalFilename = generateOriginalFilename();
    const tempFilePath = path.join('/tmp', originalFilename);
    const compressed = zlib.gzipSync(rawText);
    fs.writeFileSync(tempFilePath, compressed);

    // 2) Upload to Google Drive
    const driveFile = await uploadFileToDrive(originalFilename, tempFilePath);
    fs.unlinkSync(tempFilePath);

    // 3) Extract title and tags
    const title = extractTitle(rawText);
    const tags = JSON.stringify(['idea']);

    // 4) Insert into Postgres "entries" table
    const inserted = await sql`
      INSERT INTO entries (filename, gdrive_filename, title, tags)
      VALUES (${driveFile.id}, ${originalFilename}, ${title}, ${tags})
      RETURNING id, created_at;
    `;
    const newRow = inserted[0]; // { id: <bigint>, created_at: <timestamp> }

    res.json({
      success: true,
      id: parseInt(newRow.id),
      driveId: driveFile.id,
      webViewLink: driveFile.webViewLink,
      title
    });

  } catch (error) {
    console.error('Save error:', error);
    if (error.response && error.response.data) {
      console.error("GDrive API Error:", error.response.data);
    }
    res.status(500).json({ error: 'Internal server error during save' });
  }
});

// GET /entries — list all entries from Postgres
app.get('/entries', async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, filename, gdrive_filename, title, tags, created_at
      FROM entries
      ORDER BY created_at DESC;
    `;
    // Convert BigInt to Number for JSON
    const formatted = rows.map(r => ({
      id: parseInt(r.id),
      filename: r.filename,
      gdrive_filename: r.gdrive_filename,
      title: r.title,
      tags: r.tags,
      created_at: r.created_at
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Entries error:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// GET /entries/:id — get single entry metadata
app.get('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [row] = await sql`
      SELECT id, filename, gdrive_filename, title, tags, created_at
      FROM entries
      WHERE id = ${id};
    `;
    if (!row) return res.status(404).json({ error: 'Entry not found' });

    res.json({
      id: parseInt(row.id),
      filename: row.filename,
      gdrive_filename: row.gdrive_filename,
      title: row.title,
      tags: row.tags,
      created_at: row.created_at
    });
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// GET /load/:driveFileId — download .gz from Drive, decompress, return text
app.get('/load/:driveFileId', async (req, res) => {
  try {
    const driveFileId = req.params.driveFileId;
    const tempDownloadedFilePath = path.join('/tmp', `download-${driveFileId}.gz`);

    await downloadFileFromDrive(driveFileId, tempDownloadedFilePath);
    if (!fs.existsSync(tempDownloadedFilePath)) {
      return res.status(404).json({ error: 'File not found on Google Drive or failed to download' });
    }

    const compressed = fs.readFileSync(tempDownloadedFilePath);
    fs.unlinkSync(tempDownloadedFilePath);

    const content = zlib.gunzipSync(compressed).toString('utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    console.error('Load error:', error);
    if (error.errors && error.errors.some(e => e.reason === 'notFound')) {
      return res.status(404).json({ error: 'File not found on Google Drive' });
    }
    res.status(500).json({ error: 'Failed to load file' });
  }
});

// PUT /update/:id — update content in Drive + update title in Postgres
app.put('/update/:id', async (req, res) => {
  try {
    const dbId = parseInt(req.params.id);
    if (isNaN(dbId)) return res.status(400).json({ error: 'Invalid ID' });

    let newContent = req.body;
    if (typeof newContent === 'object') newContent = JSON.stringify(newContent);
    if (!newContent || typeof newContent !== 'string' || newContent.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid content' });
    }

    // 1) Fetch the Postgres row to get Drive File ID
    const [entry] = await sql`
      SELECT filename, gdrive_filename
      FROM entries
      WHERE id = ${dbId};
    `;
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const driveFileId = entry.filename;
    const gdriveOriginalFilename = entry.gdrive_filename || generateOriginalFilename();

    // 2) Create new .gz in /tmp and overwrite on Drive
    const tempFilePath = path.join('/tmp', `update-${driveFileId}-${Date.now()}.gz`);
    const compressed = zlib.gzipSync(newContent);
    fs.writeFileSync(tempFilePath, compressed);

    const updatedDriveFile = await updateFileInDrive(driveFileId, tempFilePath, gdriveOriginalFilename);
    fs.unlinkSync(tempFilePath);

    // 3) Update “title” in Postgres
    const newTitle = extractTitle(newContent);
    await sql`
      UPDATE entries
      SET title = ${newTitle}
      WHERE id = ${dbId};
    `;

    res.json({
      success: true,
      id: dbId,
      driveId: updatedDriveFile.id,
      webViewLink: updatedDriveFile.webViewLink,
      title: newTitle
    });
  } catch (error) {
    console.error('Update error:', error);
    if (error.response && error.response.data) {
      console.error("GDrive API Error:", error.response.data);
    }
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// DELETE /delete/:id — delete from Drive + delete row in Postgres
app.delete('/delete/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    // 1) Fetch the row to get Drive File ID
    const [row] = await sql`
      SELECT filename
      FROM entries
      WHERE id = ${id};
    `;
    if (!row) return res.status(404).json({ error: 'Entry not found' });

    const driveFileId = row.filename;

    // 2) Delete from Google Drive
    try {
      await deleteFileFromDrive(driveFileId);
    } catch (driveErr) {
      if (driveErr.errors && driveErr.errors.some(e => e.reason === 'notFound')) {
        console.warn(`GDrive file ${driveFileId} not found; continuing to delete row.`);
      } else {
        console.error('GDrive delete error:', driveErr);
        return res.status(500).json({ error: 'Failed to delete file from Google Drive' });
      }
    }

    // 3) Delete the row from Postgres
    await sql`
      DELETE FROM entries
      WHERE id = ${id};
    `;

    res.json({ success: true, message: `Entry ${id} deleted.` });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
