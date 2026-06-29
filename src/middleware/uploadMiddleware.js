const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only JPEG, JPG, PNG, and WEBP images are allowed.');
    error.status = 400;
    cb(error, false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB limit
  },
  fileFilter
});

const multerUpload = upload.array('files', 5);
const multerSingleUpload = upload.single('avatar');

const uploadAttachments = (req, res, next) => {
  multerUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      let message = err.message;
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'File size limit exceeded. Maximum file size is 5 MB.';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        message = 'Maximum of 5 files are allowed per upload request.';
      }
      const error = new Error(message);
      error.status = 400;
      return next(error);
    } else if (err) {
      return next(err);
    }
    next();
  });
};

const uploadAvatarMiddleware = (req, res, next) => {
  multerSingleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      let message = err.message;
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'File size limit exceeded. Maximum file size is 5 MB.';
      }
      const error = new Error(message);
      error.status = 400;
      return next(error);
    } else if (err) {
      return next(err);
    }
    next();
  });
};

module.exports = {
  uploadAttachments,
  uploadAvatarMiddleware
};
