import { useEffect, useState } from 'react';
import { formatFileSize } from '../../../file-tree/utils/fileTreeUtils';

interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
}

const PREVIEWABLE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]);

const FileAttachment = ({ file, onRemove, uploadProgress, error }: FileAttachmentProps) => {
  const canPreview = PREVIEWABLE_TYPES.has(file.type);
  const [preview, setPreview] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!canPreview) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, canPreview]);

  return (
    <div className="group relative">
      {canPreview ? (
        <img src={preview} alt={file.name} className="h-20 w-20 rounded object-cover" />
      ) : (
        <div className="flex h-20 w-28 flex-col items-center justify-center rounded bg-muted/60 px-2">
          <svg
            className="mb-1 h-6 w-6 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <span className="max-w-full truncate text-xs text-foreground">{file.name}</span>
          <span className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}</span>
        </div>
      )}
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-xs text-white">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-500/50">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white opacity-100 transition-opacity focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default FileAttachment;
