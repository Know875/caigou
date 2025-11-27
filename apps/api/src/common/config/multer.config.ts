import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

// 文件上传配置
// 默认限制：10MB
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || String(DEFAULT_MAX_FILE_SIZE), 10);

// 文件字段数量限制
const MAX_FILES = parseInt(process.env.MAX_FILES || '10', 10);

export const multerConfig: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: (req, file, callback) => {
    // 允许的文件类型
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/wmv',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new Error(
          `不支持的文件类型: ${file.mimetype}。允许的类型: ${allowedMimes.join(', ')}`,
        ),
        false,
      );
    }
  },
};

// 单个文件上传配置（更严格的限制）
export const singleFileConfig: MulterOptions = {
  ...multerConfig,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
};

// 多个文件上传配置
export const multipleFilesConfig: MulterOptions = {
  ...multerConfig,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
};

