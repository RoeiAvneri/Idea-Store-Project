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
app.use(cors());
app.use(bodyParser.text({ type: '*/*' }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'))); 
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) {
        console.error("Error sending index.html:", err);
        res.status(err.status || 500).send("Error loading page or Page not found");
    }
  });
});

app.get('/:pageName', (req, res, next) => {
  const page = req.params.pageName;
  // Basic security: prevent directory traversal
  if (page.includes('..')) {
    return res.status(400).send("Invalid page name");
  }
  // Only serve .html files this way to avoid conflicts with API routes
  if (page.endsWith('.html')) {
    const filePath = path.join(__dirname, 'public', page);
    res.sendFile(filePath, err => {
      if (err) {
        // If file not found, let it fall through to 404 or other API routes
        if (err.code === 'ENOENT') {
            next();
        } else {
            console.error(`Error sending ${page}:`, err);
            res.status(err.status || 500).send("Error loading page");
        }
      }
    });
  } else {
    next(); // Not an HTML file request, pass to other routes
  }
});

const DATA_DIR = path.join(__dirname, 'dataset');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = process.env.NODE_ENV === 'production' ? '/var/data/meta.db' : 'meta.db';

if (process.env.NODE_ENV === 'production') {
  const dbDirectory = path.dirname(DB_PATH); // This will be '/var/data'
  if (!fs.existsSync(dbDirectory)) {
    try {
      fs.mkdirSync(dbDirectory, { recursive: true });
      console.log(`Successfully created database directory: ${dbDirectory}`);
    } catch (err) {
      console.error(`FATAL: Error creating database directory ${dbDirectory}:`, err);
      // If you can't create the directory, the app likely can't run.
      // It's better to throw an error and let the process exit so Render can restart it,
      // rather than continuing with a broken state.
      throw new Error(`Failed to create database directory for SQLite: ${err.message}`);
    }
  }
}

// Setup database
const db = new Database(DB_PATH, { verbose: console.log });
db.prepare(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL, -- This will store the Google Drive File ID
    gdrive_filename TEXT, -- Store the original .gz filename given to GDrive (optional, for reference)
    title TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Helper: sanitize filename
function generateOriginalFilename() {
  return `entry-${Date.now()}.gz`;
}

// POST /save — compress + save file + log metadata
app.post('/save', async (req, res) => {
  try {
    const rawText = req.body; // Assuming bodyParser.text handles this
    // The 'X-Entry-Title' header from client isn't used here for title.
    // Title is derived from rawText. This is consistent with update.

    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid input' });
    }

    const originalFilename = generateOriginalFilename(); // e.g., entry-12345.gz
    const tempFilePath = path.join('/tmp', originalFilename); // Use /tmp on Render for ephemeral files

    const compressed = zlib.gzipSync(rawText);
    fs.writeFileSync(tempFilePath, compressed);

    // Upload to Google Drive
    const driveFile = await uploadFileToDrive(originalFilename, tempFilePath); // driveFile.id is the GDrive ID
    fs.unlinkSync(tempFilePath); // Clean up temp file

    const title = (rawText.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    const tags = JSON.stringify(['idea']); // Default tags

    const stmt = db.prepare(`INSERT INTO entries (filename, gdrive_filename, title, tags) VALUES (?, ?, ?, ?)`);
    const result = stmt.run(driveFile.id, originalFilename, title, tags);

    res.json({
      success: true,
      id: result.lastInsertRowid, // DB id
      driveId: driveFile.id,      // GDrive file id
      webViewLink: driveFile.webViewLink,
      title,
    });
  } catch (error) {
    console.error('Save error:', error);
    if (error.response && error.response.data) console.error("GDrive API Error:", error.response.data);
    res.status(500).json({ error: 'Internal server error during save' });
  }
});

app.get('/load/:driveFileId', async (req, res) => {
  try {
    const driveFileId = req.params.driveFileId;
    
    // Optional: Verify the entry exists in DB, though not strictly necessary if GDrive is source of truth for content
    // const entry = db.prepare('SELECT * FROM entries WHERE filename = ?').get(driveFileId);
    // if (!entry) {
    //   return res.status(404).json({ error: 'Entry metadata not found for this Drive ID' });
    // }

    const tempDownloadedFilePath = path.join('/tmp', `download-${driveFileId}.gz`);
    
    await downloadFileFromDrive(driveFileId, tempDownloadedFilePath);

    if (!fs.existsSync(tempDownloadedFilePath)) {
         // downloadFileFromDrive should throw an error if it fails, so this might be redundant
        return res.status(404).json({ error: 'File not found on Google Drive or failed to download' });
    }

    const compressed = fs.readFileSync(tempDownloadedFilePath);
    fs.unlinkSync(tempDownloadedFilePath); // Clean up temp file

    const content = zlib.gunzipSync(compressed).toString('utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    console.error('Load error:', error);
    if (error.code === 'ENOENT') { // fs.readFileSync fails if download failed silently
        res.status(404).json({ error: 'File not found locally after attempted download (likely GDrive issue)' });
    } else if (error.errors && error.errors.some(e => e.reason === 'notFound')) { // GDrive API error for not found
        res.status(404).json({ error: 'File not found on Google Drive' });
    } else {
        res.status(500).json({ error: 'Failed to load file' });
    }
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
    // Return filename (which is GDrive ID) and gdrive_filename (original .gz name)
    const rows = db.prepare(`SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries ORDER BY created_at DESC`).all();
    res.json(rows);
  } catch (error) {
    console.error('Entries error:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// DELETE /delete/:id — delete entry and file
app.delete('/delete/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id); // This is the DB id
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid DB ID' });
    }
    
    const row = db.prepare('SELECT filename FROM entries WHERE id = ?').get(id); // filename is GDrive ID
    if (!row) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }
    
    const driveFileId = row.filename;
    await deleteFileFromDrive(driveFileId); // Delete from Google Drive
    
    // Delete database record
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    
    res.json({ success: true, message: `Entry ${id} and GDrive file ${driveFileId} deleted.` });
  } catch (error) {
    console.error('Delete error:', error);
    // Check if it was a GDrive "not found" error, which might be acceptable if DB entry still exists
    if (error.code === 404 || (error.errors && error.errors.some(e => e.reason === 'notFound'))) {
        // File already not on GDrive, proceed to delete DB entry if desired, or return specific message
        // For now, let's assume if GDrive deletion fails critically, we stop.
        // If it's just "not found", we might still want to delete the DB record.
        // Current logic: if deleteFileFromDrive throws for other reasons than "not found", this catch block is hit.
        // If deleteFileFromDrive handles "not found" gracefully (as modified), this won't be an issue here.
         db.prepare('DELETE FROM entries WHERE id = ?').run(id); // Still delete DB record
         return res.json({ success: true, message: `GDrive file ${driveFileId} not found, DB entry ${id} deleted.` });
    }
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.put('/update/:id', async (req, res) => {
  try {
    const dbId = parseInt(req.params.id);
    if (isNaN(dbId)) {
      return res.status(400).json({ error: 'Invalid DB ID' });
    }

    const newContent = req.body; // Assuming bodyParser.text handles this
    if (!newContent || typeof newContent !== 'string' || newContent.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid content' });
    }

    const entry = db.prepare('SELECT id, filename, gdrive_filename FROM entries WHERE id = ?').get(dbId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }

    const driveFileId = entry.filename;
    const gdriveOriginalFilename = entry.gdrive_filename || generateOriginalFilename(); // Use existing or generate if missing

    const tempFilePath = path.join('/tmp', `update-${driveFileId}-${Date.now()}.gz`);
    const compressed = zlib.gzipSync(newContent);
    fs.writeFileSync(tempFilePath, compressed);

    // Update file in Google Drive
    const updatedDriveFile = await updateFileInDrive(driveFileId, tempFilePath, gdriveOriginalFilename);
    fs.unlinkSync(tempFilePath); // Clean up temp file

    const newTitle = (newContent.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    // Tags are not updated in this version, kept from original or could be parsed
    // const newTags = entry.tags; // Assuming tags are not changed by content update

    db.prepare(`
      UPDATE entries
      SET title = ? 
      WHERE id = ? 
    `).run(newTitle, dbId); // Only updating title for now

    res.json({
      success: true,
      id: dbId,
      driveId: updatedDriveFile.id, // Should be same as driveFileId
      webViewLink: updatedDriveFile.webViewLink,
      title: newTitle,
    });

  } catch (error) {
    console.error('Update error:', error);
    if (error.response && error.response.data) console.error("GDrive API Error:", error.response.data);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

app.get('/entries/:id', (req, res) => { // This gets metadata for a single entry by DB ID
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const row = db.prepare(`SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries WHERE id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json(row); // Send all details including GDrive ID (filename) and original .gz name
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Database is at: ${DB_PATH}`);
  if (process.env.NODE_ENV === 'production' && !fs.existsSync(path.dirname(DB_PATH))) {
    console.warn(`WARNING: Directory for production database ${path.dirname(DB_PATH)} does not exist. Make sure your persistent disk is mounted correctly.`);
  }
});

// Fallback 404 for API routes not matched
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});
