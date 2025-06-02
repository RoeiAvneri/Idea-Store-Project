const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const mime = require('mime-types');

// Path to write/read the key file inside the scripts folder
const clientSecretPath = path.join(__dirname, 'client_secret.json');

// If not exists and env is available, write it at runtime
if (!fs.existsSync(clientSecretPath) && process.env.GOOGLE_SERVICE_JSON) {
  fs.writeFileSync(clientSecretPath, process.env.GOOGLE_SERVICE_JSON);
}

// Load GoogleAuth
const auth = new google.auth.GoogleAuth({
  keyFile: clientSecretPath,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

async function uploadFileToDrive(filename, filepath) {
  const fileMetadata = { name: filename };
  const media = {
    mimeType: mime.lookup(filepath),
    body: fs.createReadStream(filepath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
  });

  return response.data;
}

module.exports = { uploadFileToDrive };
