const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const Database = require('better-sqlite3');

const { uploadFileToDrive, downloadFileFromDrive, deleteFileFromDrive, updateFileInDrive } = require('./GDriveHelper');

// Setup
const app = express();

// CORS configuration - Allow your GitHub Pages domain
const corsOptions = {
  origin: [
    'https://yourusername.github.io', // Replace with your actual GitHub Pages URL
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500', // For local development
    'https://your-github-pages-domain.github.io'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Entry-Title']
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Body parser middleware - order matters
app.use(bodyParser.json());
app.use(bodyParser.text({ type: 'text/plain' }));
app.use(bodyParser.text({ type: '*/*' }));

// Static files
app.use(express.static(path.join(__dirname, 'public'))); 

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) {
        console.error("Error sending index.html:", err);
        res.status(err.status || 500).send("Error loading page or Page not found");
    }
  });
});

// HTML page routes
app.get('/:pageName', (req, res, next) => {
  const page = req.params.pageName;
  if (page.includes('..')) {
    return res.status(400).send("Invalid page name");
  }
  if (page.endsWith('.html')) {
    const filePath = path.join(__dirname, 'public', page);
    res.sendFile(filePath, err => {
      if (err) {
        if (err.code === 'ENOENT') {
            next();
        } else {
            console.error(`Error sending ${page}:`, err);
            res.status(err.status || 500).send("Error loading page");
        }
      }
    });
  } else {
    next();
  }
});

// Data directory and database setup
const DATA_DIR = path.join(__dirname, 'dataset');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = process.env.NODE_ENV === 'production' ? '/var/data/meta.db' : 'meta.db';

// Setup database
const db = new Database(DB_PATH, { verbose: console.log });
db.prepare(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    gdrive_filename TEXT,
    title TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Helper functions
function generateOriginalFilename() {
  return `entry-${Date.now()}.gz`;
}

function extractTitle(content) {
  if (!content || typeof content !== 'string') return 'Untitled';
  
  const lines = content.split('\n');
  const firstLine = lines[0] || '';
  
  // Remove markdown headers and trim
  const title = firstLine.replace(/^#+\s*/, '').trim();
  return title || 'Untitled';
}

// API Routes

// POST /save — Save new entry
app.post('/save', async (req, res) => {
  console.log('POST /save called');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Body type:', typeof req.body);
  
  try {
    let rawText = req.body;
    
    // Handle different body parsing scenarios
    if (typeof rawText === 'object') {
      rawText = JSON.stringify(rawText);
    }
    
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      console.log('Invalid input received:', rawText);
      return res.status(400).json({ error: 'Empty or invalid input' });
    }

    const originalFilename = generateOriginalFilename();
    const tempFilePath = path.join('/tmp', originalFilename);

    // Compress and save temporarily
    const compressed = zlib.gzipSync(rawText);
    fs.writeFileSync(tempFilePath, compressed);

    // Upload to Google Drive
    console.log('Uploading to Google Drive...');
    const driveFile = await uploadFileToDrive(originalFilename, tempFilePath);
    fs.unlinkSync(tempFilePath); // Clean up

    // Extract title and prepare data
    const title = extractTitle(rawText);
    const tags = JSON.stringify(['idea']);

    // Save to database
    const stmt = db.prepare(`INSERT INTO entries (filename, gdrive_filename, title, tags) VALUES (?, ?, ?, ?)`);
    const result = stmt.run(driveFile.id, originalFilename, title, tags);

    console.log('Entry saved successfully:', {
      dbId: result.lastInsertRowid,
      driveId: driveFile.id,
      title: title
    });

    res.json({
      success: true,
      id: result.lastInsertRowid,
      driveId: driveFile.id,
      webViewLink: driveFile.webViewLink,
      title: title,
    });
  } catch (error) {
    console.error('Save error:', error);
    if (error.response && error.response.data) {
      console.error("GDrive API Error:", error.response.data);
    }
    res.status(500).json({ error: 'Internal server error during save' });
  }
});

// GET /load/:driveFileId — Load file content by Google Drive ID
app.get('/load/:driveFileId', async (req, res) => {
  console.log('GET /load/:driveFileId called with ID:', req.params.driveFileId);
  
  try {
    const driveFileId = req.params.driveFileId;
    const tempDownloadedFilePath = path.join('/tmp', `download-${driveFileId}.gz`);
    
    console.log('Downloading from Google Drive...');
    await downloadFileFromDrive(driveFileId, tempDownloadedFilePath);

    if (!fs.existsSync(tempDownloadedFilePath)) {
      console.log('File not found after download attempt');
      return res.status(404).json({ error: 'File not found on Google Drive or failed to download' });
    }

    const compressed = fs.readFileSync(tempDownloadedFilePath);
    fs.unlinkSync(tempDownloadedFilePath); // Clean up

    const content = zlib.gunzipSync(compressed).toString('utf-8');
    console.log('File loaded successfully, content length:', content.length);
    
    res.type('text/plain').send(content);
  } catch (error) {
    console.error('Load error:', error);
    if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found locally after attempted download' });
    } else if (error.errors && error.errors.some(e => e.reason === 'notFound')) {
        res.status(404).json({ error: 'File not found on Google Drive' });
    } else {
        res.status(500).json({ error: 'Failed to load file' });
    }
  }
});

// GET /entries — List all entries
app.get('/entries', (req, res) => {
  console.log('GET /entries called');
  
  try {
    const rows = db.prepare(`SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries ORDER BY created_at DESC`).all();
    console.log(`Returning ${rows.length} entries`);
    res.json(rows);
  } catch (error) {
    console.error('Entries error:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// GET /entries/:id — Get specific entry metadata
app.get('/entries/:id', (req, res) => {
  console.log('GET /entries/:id called with ID:', req.params.id);
  
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const row = db.prepare(`SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries WHERE id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    console.log('Entry found:', row);
    res.json(row);
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// PUT /update/:id — Update entry content
app.put('/update/:id', async (req, res) => {
  console.log('PUT /update/:id called with ID:', req.params.id);
  console.log('Content-Type:', req.headers['content-type']);
  
  try {
    const dbId = parseInt(req.params.id);
    if (isNaN(dbId)) {
      return res.status(400).json({ error: 'Invalid DB ID' });
    }

    let newContent = req.body;
    
    // Handle different body parsing scenarios
    if (typeof newContent === 'object') {
      newContent = JSON.stringify(newContent);
    }
    
    if (!newContent || typeof newContent !== 'string' || newContent.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid content' });
    }

    // Get existing entry
    const entry = db.prepare('SELECT id, filename, gdrive_filename FROM entries WHERE id = ?').get(dbId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }

    const driveFileId = entry.filename;
    const gdriveOriginalFilename = entry.gdrive_filename || generateOriginalFilename();

    // Prepare new compressed file
    const tempFilePath = path.join('/tmp', `update-${driveFileId}-${Date.now()}.gz`);
    const compressed = zlib.gzipSync(newContent);
    fs.writeFileSync(tempFilePath, compressed);

    // Update file in Google Drive
    console.log('Updating file in Google Drive...');
    const updatedDriveFile = await updateFileInDrive(driveFileId, tempFilePath, gdriveOriginalFilename);
    fs.unlinkSync(tempFilePath); // Clean up

    // Update database
    const newTitle = extractTitle(newContent);
    db.prepare(`UPDATE entries SET title = ? WHERE id = ?`).run(newTitle, dbId);

    console.log('Entry updated successfully:', {
      dbId: dbId,
      driveId: updatedDriveFile.id,
      title: newTitle
    });

    res.json({
      success: true,
      id: dbId,
      driveId: updatedDriveFile.id,
      webViewLink: updatedDriveFile.webViewLink,
      title: newTitle,
    });

  } catch (error) {
    console.error('Update error:', error);
    if (error.response && error.response.data) {
      console.error("GDrive API Error:", error.response.data);
    }

    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// ──────────────────────────────
// DELETE /delete/:id — Remove an entry
// ──────────────────────────────
app.delete('/delete/:id', async (req, res) => {
  console.log('DELETE /delete/:id called with ID:', req.params.id);

  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    // 1) Fetch the row from SQLite to get the Drive File ID
    const row = db.prepare('SELECT filename FROM entries WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }
    const driveFileId = row.filename;

    // 2) Delete from Google Drive
    console.log(`Deleting file ${driveFileId} from Google Drive...`);
    try {
      await deleteFileFromDrive(driveFileId);
    } catch (driveErr) {
      if (driveErr.errors && driveErr.errors.some(e => e.reason === 'notFound')) {
        console.warn(`GDrive file ${driveFileId} not found, proceeding to delete DB row.`);
      } else {
        console.error('GDrive delete error:', driveErr);
        return res.status(500).json({ error: 'Failed to delete file from Google Drive' });
      }
    }

    // 3) Delete the SQLite row
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);

    console.log(`Entry ${id} deleted successfully (and Drive file ${driveFileId}).`);
    res.json({ success: true, message: `Entry ${id} deleted.` });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ──────────────────────────
// 404 fallback for API routes
// ──────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// ──────────────────────────
// Start the server
// ──────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Database path: ${DB_PATH}`);
});
