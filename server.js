const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const Database = require('better-sqlite3');

const { uploadFileToDrive } = require('driveHelper');


// Setup
const app = express();
app.use(cors());
app.use(bodyParser.text({ type: '*/*' }));
app.use(express.json());

app.get('/:page', (req, res, next) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);
  res.sendFile(filePath, err => {
    if (err) next(); // Let other routes handle it
  });
});


const DATA_DIR = path.join(__dirname, 'dataset');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Setup database
const db = new Database('meta.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    title TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Helper: sanitize filename
function generateFilename() {
  return `entry-${Date.now()}.gz`;
}

// POST /save — compress + save file + log metadata
app.post('/save', async (req, res) => {
  try {
    const rawText = req.body;
    if (!rawText || rawText.trim() === '') {
      return res.status(400).json({ error: 'Empty input' });
    }

    const filename = generateFilename();
    const filePath = path.join('/tmp', filename); // use /tmp in Render!
    const compressed = zlib.gzipSync(rawText);
    fs.writeFileSync(filePath, compressed);

    const driveFile = await uploadFileToDrive(filename, filePath);

    // Save metadata in SQLite (or eventually Google Sheets, Supabase, etc.)
    const title = (rawText.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    const tags = JSON.stringify(['idea']);

    const stmt = db.prepare(`INSERT INTO entries (filename, title, tags) VALUES (?, ?, ?)`);
    const result = stmt.run(driveFile.id, title, tags);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      driveId: driveFile.id,
      webViewLink: driveFile.webViewLink,
      title,
    });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /load/:filename — decompress and return file content
app.get('/load/:filename', (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const compressed = fs.readFileSync(filePath);
    const content = zlib.gunzipSync(compressed).toString('utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    console.error('Load error:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
});

// GET /entries — list all saved metadata
app.get('/entries', (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at DESC`).all();
    res.json(rows);
  } catch (error) {
    console.error('Entries error:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// DELETE /delete/:id — delete entry and file
app.delete('/delete/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    
    // Find entry by id
    const row = db.prepare('SELECT filename FROM entries WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const filePath = path.join(DATA_DIR, row.filename);
    
    // Delete file if exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Delete database record
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.put('/update/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const newContent = req.body;
    if (!newContent || newContent.trim() === '') {
      return res.status(400).json({ error: 'Empty content' });
    }

    // Get entry to find filename and current metadata
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const filePath = path.join(DATA_DIR, entry.filename);

    // Overwrite the file content (compress before saving)
    const compressed = zlib.gzipSync(newContent);
    fs.writeFileSync(filePath, compressed);

    // Optionally update metadata (e.g., title and tags) based on newContent
    const newTitle = (newContent.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    // For example, keep tags the same or parse new tags here:
    const newTags = entry.tags; // or modify if you want

    // Update DB entry with new title (and tags if changed)
    db.prepare(`
      UPDATE entries
      SET title = ?, tags = ?
      WHERE id = ?
    `).run(newTitle, newTags, id);

    res.json({ success: true, id, filename: entry.filename, title: newTitle });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// GET /entries/:id — get specific entry with content
app.get('/entries/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const row = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Only return metadata (same as /entries)
    res.json({
      id: row.id,
      title: row.title,
      tags: row.tags,
      created_at: row.created_at,
      filename: row.filename
    });
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

app.use((req, res) => {
  res.status(404).send("Not found");
});

if (app.close) {
  app.close(() => {
    console.log('Server Closed.');
  });
}
