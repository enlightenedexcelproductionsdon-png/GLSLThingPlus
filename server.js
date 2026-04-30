// Simple Express static server with upload endpoint
// Usage: npm install express multer
const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + file.originalname.replace(/[^\w.-]/g,'_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname)));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
  res.json({ ok: true, path: '/uploads/' + req.file.filename });
});

app.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});