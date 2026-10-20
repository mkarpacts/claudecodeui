import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type JSZip from 'jszip';
import { Button } from '../../../../shared/view/ui/Button';
import { saveBlob } from '../../../../utils/saveBlob';
import type { FileTreeNode } from '../../../file-tree/types/types';
import { formatFileSize, isImageFile } from '../../../file-tree/utils/fileTreeUtils';
import { getFileExtension, isBinaryFile } from '../../utils/binaryFile';
import { decodeUtf8Or } from '../../utils/zipFileName';
import { BinaryPreviewError, BinaryPreviewLoading } from './BinaryPreviewStatus';

// A file inside an archive, with the JSZip entry it is extracted from
export type ArchiveFileNode = FileTreeNode & { entry: JSZip.JSZipObject };

// Limits on the unpacked size: a small archive can unpack to gigabytes
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
// Download unpacks in page memory too; past this the whole archive has to be downloaded instead
const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

// A NUL byte this early means binary content behind a text-looking (or missing) extension
const BINARY_SNIFF_BYTES = 8000;

// Not valid UTF-8: most likely an older Czech file
const windows1250Decoder = new TextDecoder('windows-1250');
const decodeWindows1250 = (bytes: Uint8Array) => windows1250Decoder.decode(bytes);

type Chunk = Uint8Array<ArrayBuffer>;

// JSZip's streaming API exists at runtime but is missing from its typings
type EntryStream = {
  on(event: 'data', callback: (chunk: Chunk) => void): EntryStream;
  on(event: 'end', callback: () => void): EntryStream;
  on(event: 'error', callback: (error: Error) => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
};

class EntryTooLarge extends Error {}

// Unpacks chunk by chunk and stops past maxBytes. The size an archive declares can lie,
// and JSZip only checks it after inflating everything.
function extractEntry(entry: JSZip.JSZipObject, maxBytes: number): Promise<Chunk[]> {
  return new Promise((resolve, reject) => {
    const chunks: Chunk[] = [];
    let total = 0;
    const stream = (entry as unknown as { internalStream(type: 'uint8array'): EntryStream }).internalStream('uint8array');
    stream
      .on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.pause();
          reject(new EntryTooLarge());
          return;
        }
        chunks.push(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve(chunks))
      .resume();
  });
}

const concatChunks = (chunks: Chunk[]) => {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

type ViewerState =
  | { status: 'loading' }
  | { status: 'text'; text: string }
  | { status: 'image'; url: string }
  | { status: 'unavailable'; reason: 'binary' | 'tooLarge' | 'error' };

type ZipEntryViewerProps = {
  file: ArchiveFileNode;
  onBack: () => void;
};

// Mounted once per opened file (keyed by the caller), so it never has to reset for another one
export default function ZipEntryViewer({ file, onBack }: ZipEntryViewerProps) {
  const { t } = useTranslation('codeEditor');
  const [state, setState] = useState<ViewerState>({ status: 'loading' });
  const [downloadError, setDownloadError] = useState<'failed' | 'tooLarge' | null>(null);
  // The image being shown, reused by Download; text is extracted again on Download instead
  const imageBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    // Extraction cannot be cancelled: a result that arrives after closing is dropped
    let current = true;
    let objectUrl: string | null = null;

    const isImage = isImageFile(file.name);
    const limit = isImage ? IMAGE_PREVIEW_MAX_BYTES : TEXT_PREVIEW_MAX_BYTES;
    if (!isImage && isBinaryFile(file.name)) {
      setState({ status: 'unavailable', reason: 'binary' });
      return undefined;
    }
    // The declared size settles most cases without unpacking anything
    if ((file.size ?? 0) > limit) {
      setState({ status: 'unavailable', reason: 'tooLarge' });
      return undefined;
    }

    const extract = async () => {
      const chunks = await extractEntry(file.entry, limit);
      if (!current) return;

      if (isImage) {
        // A blob: URL only renders SVG with its exact type; raster formats are sniffed by the browser
        const type = getFileExtension(file.name) === 'svg' ? 'image/svg+xml' : '';
        const image = new Blob(chunks, { type });
        imageBlobRef.current = image;
        objectUrl = URL.createObjectURL(image);
        setState({ status: 'image', url: objectUrl });
        return;
      }

      const bytes = concatChunks(chunks);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        setState({ status: 'unavailable', reason: 'binary' });
        return;
      }
      setState({ status: 'text', text: decodeUtf8Or(bytes, decodeWindows1250) });
    };

    extract().catch((error: unknown) => {
      if (!current) return;
      if (error instanceof EntryTooLarge) {
        setState({ status: 'unavailable', reason: 'tooLarge' });
        return;
      }
      console.error('Error extracting archive entry:', error);
      setState({ status: 'unavailable', reason: 'error' });
    });

    return () => {
      current = false;
      // Without this the image's bytes would stay alive as long as the page
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      imageBlobRef.current = null;
    };
  }, [file]);

  // Escape goes back to the archive. Captured on document so the editor's own Escape
  // handler (close the whole editor) never sees it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onBack]);

  // A failure is reported next to the button; the preview itself stays as it is
  const handleDownload = async () => {
    setDownloadError(null);
    try {
      const blob = imageBlobRef.current ?? new Blob(await extractEntry(file.entry, DOWNLOAD_MAX_BYTES));
      saveBlob(blob, file.name);
    } catch (error) {
      if (!(error instanceof EntryTooLarge)) {
        console.error('Error extracting archive entry:', error);
      }
      setDownloadError(error instanceof EntryTooLarge ? 'tooLarge' : 'failed');
    }
  };

  const backLabel = t('zipPreview.back', 'Back to archive');
  const unavailableMessages = {
    binary: t('zipPreview.entryBinary', 'This file cannot be previewed. Download it to open it.'),
    tooLarge: t('zipPreview.entryTooLarge', 'This file is too large to preview. Download it to open it.'),
    error: t('zipPreview.entryError', 'This file could not be extracted from the archive.'),
  };
  const downloadErrorMessages = {
    failed: t('binaryPreview.downloadFailed', 'Download failed. Try again.'),
    tooLarge: t('zipPreview.entryDownloadTooLarge', 'Too large to extract here. Download the whole archive instead.'),
  };

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={onBack}
          title={backLabel}
          aria-label={backLabel}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground" title={file.path}>{file.path}</div>
          <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>
        </div>
        {downloadError && <span className="text-xs text-destructive">{downloadErrorMessages[downloadError]}</span>}
        {!(state.status === 'unavailable' && state.reason === 'error') && (
          <Button size="sm" onClick={handleDownload}>
            {t('binaryPreview.download', 'Download')}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {state.status === 'loading' && <BinaryPreviewLoading label={t('zipPreview.entryLoading', 'Extracting file...')} />}
        {state.status === 'text' && (
          <pre className="whitespace-pre p-3 font-mono text-xs text-foreground">{state.text}</pre>
        )}
        {state.status === 'image' && (
          <div className="flex min-h-full items-center justify-center p-4">
            <img
              src={state.url}
              alt={file.name}
              className="max-h-full max-w-full object-contain"
              // A damaged image or a variant the browser cannot decode
              onError={() => setState({ status: 'unavailable', reason: 'binary' })}
            />
          </div>
        )}
        {state.status === 'unavailable' && <BinaryPreviewError message={unavailableMessages[state.reason]} />}
      </div>
    </div>
  );
}
