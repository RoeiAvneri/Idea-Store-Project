// GDriveHelper.js
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const mime = require('mime-types');

const clientSecretPath = path.join(__dirname, 'client_secret.json');

if (!fs.existsSync(clientSecretPath) && process.env.GOOGLE_SERVICE_JSON) {
  fs.writeFileSync(clientSecretPath, process.env.GOOGLE_SERVICE_JSON);
}

const auth = new google.auth.GoogleAuth({
  keyFile: clientSecretPath,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

async function uploadFileToDrive(filename, filepath) {
  const fileMetadata = { name: filename };
  const media = {
    mimeType: mime.lookup(filepath) || 'application/octet-stream',
    body: fs.createReadStream(filepath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
  });

  return response.data;
}

async function downloadFileFromDrive(fileId, downloadPath) {
  const dest = fs.createWriteStream(downloadPath);
  const res = await drive.files.get(
    { fileId: fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return new Promise((resolve, reject) => {
    res.data
      .on('end', () => {
        // console.log(`Downloaded ${fileId} to ${downloadPath}`);
        resolve();
      })
      .on('error', err => {
        console.error(`Error downloading ${fileId}:`, err);
        reject(err);
      })
      .pipe(dest);
  });
}

async function deleteFileFromDrive(fileId) {
  try {
    await drive.files.delete({ fileId: fileId });
    // console.log(`Deleted file ${fileId} from Google Drive.`);
  } catch (error) {
    console.error(`Error deleting file ${fileId} from Google Drive:`, error);
    // If file not found, GDrive API might throw an error.
    // Depending on desired behavior, you might want to catch specific errors (e.g., 404)
    // and not treat them as critical if the goal is "ensure it's not there".
    if (error.code !== 404) { // Example: re-throw if not a "not found" error
        throw error;
    }
  }
}

async function updateFileInDrive(fileId, newLocalFilePath, newOriginalFilename) {
    // newOriginalFilename is the name you want the file to have on Drive, e.g., entry-timestamp.gz
    // newLocalFilePath is the path to the new compressed content on the server's /tmp
  const media = {
    mimeType: mime.lookup(newLocalFilePath) || 'application/octet-stream',
    body: fs.createReadStream(newLocalFilePath),
  };

  // If you also want to update the filename metadata on Drive (optional)
  const fileMetadata = {};
  if (newOriginalFilename) {
    fileMetadata.name = newOriginalFilename;
  }

  const response = await drive.files.update({
    fileId: fileId,
    media: media,
    resource: Object.keys(fileMetadata).length > 0 ? fileMetadata : undefined,
    fields: 'id, webViewLink',
  });
  return response.data;
}

module.exports = { uploadFileToDrive, downloadFileFromDrive, deleteFileFromDrive, updateFileInDrive };
