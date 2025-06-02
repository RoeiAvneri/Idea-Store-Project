// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs'); // Still needed for /tmp file operations with GDrive
const zlib = require('zlib'); // Still needed for compression
const path = require('path'); // Still needed for path.join

// GDriveHelper (assuming it's correct for GDrive operations)
const { uploadFileToDrive, downloadFileFromDrive, deleteFileFromDrive, updateFileInDrive } = require('./GDriveHelper');

// --- PostgreSQL Setup ---
const { Pool } = require('pg');
let pool;

if (!process.env.SUPABASE_DATABASE_URL && process.env.NODE_ENV !== 'test') { // Added NODE_ENV check for local testing without env var
    console.error("FATAL ERROR: SUPABASE_DATABASE_URL environment variable is not set.");
    // For local development if you don't want to set env vars, you can temporarily hardcode it here
    // OR use a .env file with a library like dotenv (npm install dotenv)
    // Example with dotenv: require('dotenv').config(); then SUPABASE_DATABASE_URL would be in .env
    // For Render, environment variables are the way to go.
    // process.exit(1); // Exiting might be too harsh during local dev, but good for prod
    console.warn("Continuing without database for local dev if SUPABASE_DATABASE_URL is not set. API endpoints requiring DB will fail.");
} else {
    pool = new Pool({
        connectionString: process.env.SUPABASE_DATABASE_URL,
        // Supabase typically uses SSL, pg defaults to it if connection string starts with postgres:// and implies SSL.
        // For some direct connections or older pg versions, you might need:
        // ssl: { rejectUnauthorized: false } // Use with caution, prefer Supabase's provided CA cert if issues
    });

    pool.on('connect', () => {
        console.log('Connected to Supabase PostgreSQL database!');
    });

    pool.on('error', (err) => {
        console.error('Unexpected error on idle client in Supabase PostgreSQL pool', err);
        process.exit(-1); // Exit if the pool has a critical error
    });
}


async function initializeDatabase() {
    if (!pool) {
        console.warn("Database pool not initialized. Skipping table creation.");
        return;
    }
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,        -- Google Drive File ID
        gdrive_filename TEXT,          -- Original .gz filename given to GDrive
        title TEXT,
        tags TEXT,                     -- Storing as JSON string for simplicity
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    `;
    try {
        await pool.query(createTableQuery);
        console.log("Database table 'entries' is ready (checked/created).");
    } catch (err) {
        console.error("Error initializing database table 'entries':", err);
        // Depending on the error, you might want to exit or retry
        throw err; // Re-throw to prevent server from starting in a bad state
    }
}

// Initialize DB on server start
initializeDatabase().catch(err => {
    console.error("Failed to initialize database. Server might not work correctly.", err);
    // process.exit(1); // Optional: exit if DB init fails critically
});
// --- End PostgreSQL Setup ---


// Setup Express App
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
  if (page.includes('..')) {
    return res.status(400).send("Invalid page name");
  }
  if (page.endsWith('.html')) {
    const filePath = path.join(__dirname, 'public', page);
    res.sendFile(filePath, err => {
      if (err) {
        if (err.code === 'ENOENT') next();
        else {
            console.error(`Error sending ${page}:`, err);
            res.status(err.status || 500).send("Error loading page");
        }
      }
    });
  } else {
    next();
  }
});


function generateOriginalFilename() {
  return `entry-${Date.now()}.gz`;
}

// POST /save
app.post('/save', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  try {
    const rawText = req.body;
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid input' });
    }

    const originalFilename = generateOriginalFilename();
    const tempFilePath = path.join('/tmp', originalFilename);
    const compressed = zlib.gzipSync(rawText);
    fs.writeFileSync(tempFilePath, compressed);

    const driveFile = await uploadFileToDrive(originalFilename, tempFilePath);
    fs.unlinkSync(tempFilePath);

    const title = (rawText.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    const tags = JSON.stringify(['idea']); // Default tags

    const query = `
      INSERT INTO entries (filename, gdrive_filename, title, tags)
      VALUES ($1, $2, $3, $4)
      RETURNING id, title, created_at;
    `;
    const values = [driveFile.id, originalFilename, title, tags];
    const dbResult = await pool.query(query, values);

    res.json({
      success: true,
      id: dbResult.rows[0].id,
      driveId: driveFile.id,
      webViewLink: driveFile.webViewLink,
      title: dbResult.rows[0].title,
    });
  } catch (error) {
    console.error('Save error:', error);
    if (error.response && error.response.data) console.error("GDrive API Error:", error.response.data);
    res.status(500).json({ error: 'Internal server error during save' });
  }
});

// GET /load/:driveFileId
app.get('/load/:driveFileId', async (req, res) => {
    // This route doesn't need the DB if it's just fetching from GDrive by GDrive ID
  try {
    const driveFileId = req.params.driveFileId;
    const tempDownloadedFilePath = path.join('/tmp', `download-${driveFileId}-${Date.now()}.gz`); // Added Date.now() for more uniqueness
    
    await downloadFileFromDrive(driveFileId, tempDownloadedFilePath);

    if (!fs.existsSync(tempDownloadedFilePath)) {
        return res.status(404).json({ error: 'File not found on Google Drive or failed to download' });
    }

    const compressedData = fs.readFileSync(tempDownloadedFilePath);
    fs.unlinkSync(tempDownloadedFilePath);

    const content = zlib.gunzipSync(compressedData).toString('utf-8');
    res.type('text/plain').send(content);
  } catch (error) {
    console.error('Load error:', error);
    if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found locally after attempted download (likely GDrive issue)' });
    } else if (error.errors && error.errors.some(e => e.reason === 'notFound')) {
        res.status(404).json({ error: 'File not found on Google Drive' });
    } else {
        res.status(500).json({ error: 'Failed to load file' });
    }
  }
});

// GET /entries — list all saved metadata
app.get('/entries', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  try {
    const result = await pool.query(`SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('Entries error:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// DELETE /delete/:id (DB id)
app.delete('/delete/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  const client = await pool.connect(); // Use a client for transaction-like behavior (optional here but good practice)
  try {
    const dbId = parseInt(req.params.id);
    if (isNaN(dbId)) {
      return res.status(400).json({ error: 'Invalid DB ID' });
    }
    
    // First, get the GDrive file ID from the database
    const selectQuery = 'SELECT filename FROM entries WHERE id = $1';
    const selectResult = await client.query(selectQuery, [dbId]);

    if (selectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }
    const driveFileId = selectResult.rows[0].filename;

    // Delete from Google Drive
    if (driveFileId) { // Only attempt delete if there's a driveFileId
        await deleteFileFromDrive(driveFileId);
    }
    
    // Delete database record
    const deleteQuery = 'DELETE FROM entries WHERE id = $1 RETURNING id';
    const deleteDbResult = await client.query(deleteQuery, [dbId]);

    if (deleteDbResult.rowCount > 0) {
        res.json({ success: true, message: `Entry ${dbId} and associated GDrive file ${driveFileId || '(none)'} processed for deletion.` });
    } else {
        res.status(404).json({ error: 'Entry not found for deletion, or already deleted.' });
    }
  } catch (error) {
    console.error('Delete error:', error);
    if (error.code === 404 || (error.errors && error.errors.some(e => e.reason === 'notFound'))) {
        // GDrive file was not found, but we might still want to delete the DB entry.
        // The current logic attempts to delete DB entry regardless if select was successful.
        // Consider if this case needs special handling or if the DB delete should always run if metadata existed.
         return res.status(500).json({ error: 'Error during GDrive deletion, DB record may still exist or be deleted.' });
    }
    res.status(500).json({ error: 'Failed to delete entry' });
  } finally {
    client.release(); // Release the client back to the pool
  }
});

// PUT /update/:id (DB id)
app.put('/update/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  const client = await pool.connect();
  try {
    const dbId = parseInt(req.params.id);
    if (isNaN(dbId)) {
      return res.status(400).json({ error: 'Invalid DB ID' });
    }

    const newContent = req.body;
    if (!newContent || typeof newContent !== 'string' || newContent.trim() === '') {
      return res.status(400).json({ error: 'Empty or invalid content' });
    }

    const entrySelectQuery = 'SELECT filename, gdrive_filename FROM entries WHERE id = $1';
    const entryResult = await client.query(entrySelectQuery, [dbId]);

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found in database' });
    }
    const { filename: driveFileId, gdrive_filename: gdriveOriginalFilenameFromDb } = entryResult.rows[0];
    
    if (!driveFileId) {
        return res.status(500).json({ error: 'Database entry is missing Google Drive file ID.' });
    }

    const gdriveOriginalFilename = gdriveOriginalFilenameFromDb || generateOriginalFilename();
    const tempFilePath = path.join('/tmp', `update-${driveFileId}-${Date.now()}.gz`);
    const compressed = zlib.gzipSync(newContent);
    fs.writeFileSync(tempFilePath, compressed);

    const updatedDriveFile = await updateFileInDrive(driveFileId, tempFilePath, gdriveOriginalFilename);
    fs.unlinkSync(tempFilePath);

    const newTitle = (newContent.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    
    const updateDbQuery = `
      UPDATE entries
      SET title = $1
      WHERE id = $2
      RETURNING id, title;
    `;
    // Note: gdrive_filename is not updated here unless the original was missing.
    // If you want to update gdrive_filename consistently:
    // SET title = $1, gdrive_filename = $2 WHERE id = $3
    // and add 'gdriveOriginalFilename' to values array
    const dbUpdateResult = await client.query(updateDbQuery, [newTitle, dbId]);

    res.json({
      success: true,
      id: dbUpdateResult.rows[0].id,
      driveId: updatedDriveFile.id,
      webViewLink: updatedDriveFile.webViewLink,
      title: dbUpdateResult.rows[0].title,
    });

  } catch (error) {
    console.error('Update error:', error);
    if (error.response && error.response.data) console.error("GDrive API Error:", error.response.data);
    res.status(500).json({ error: 'Failed to update entry' });
  } finally {
    client.release();
  }
});

// GET /entries/:id (DB id) — get specific entry metadata
app.get('/entries/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const query = `SELECT id, filename, gdrive_filename, title, tags, created_at FROM entries WHERE id = $1`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (process.env.SUPABASE_DATABASE_URL) {
    console.log(`Attempting to connect to Supabase...`);
  } else if (process.env.NODE_ENV !== 'test') {
    console.warn(`SUPABASE_DATABASE_URL is not set. Database features will be unavailable.`);
  }
});

// Fallback 404 for API routes not matched
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});
