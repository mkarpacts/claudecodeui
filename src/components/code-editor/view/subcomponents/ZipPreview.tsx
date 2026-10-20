import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type JSZip from 'jszip';
import { cn } from '../../../../lib/utils';
import { Button } from '../../../../shared/view/ui/Button';
import { api } from '../../../../utils/api';
import { downloadProjectFile } from '../../../../utils/downloadProjectFile';
import { saveBlob } from '../../../../utils/saveBlob';
import { useExpandedDirectories } from '../../../file-tree/hooks/useExpandedDirectories';
import type { FileTreeNode } from '../../../file-tree/types/types';
import { formatFileSize, sortFileTree } from '../../../file-tree/utils/fileTreeUtils';
import { renderFileIcon } from '../../../file-tree/utils/renderFileIcon';
import { TreeItemIcon } from '../../../file-tree/view/FileTreeNode';
import type { BinaryPreviewProps } from '../../types/types';
import { failureFromStatus, failureKindOf, PreviewFailure, type FetchFailureKind } from '../../utils/binaryPreview';
import { decodeZipFileName } from '../../utils/zipFileName';
import { BinaryPreviewError, BinaryPreviewLoading } from './BinaryPreviewStatus';

// JSZip holds the whole archive in memory (twice, as a Blob and an ArrayBuffer)
const ZIP_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

// Name | size | modified — shared by the header and every row so the columns line up
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_5rem_8.5rem] items-center gap-2 px-3';

type FailureKind = FetchFailureKind | 'tooLarge' | 'corrupt' | 'encrypted';

// Entries use the project tree's node shape, so they sort and look like it
type Archive = {
  nodes: FileTreeNode[];
  fileCount: number;
  totalSize: number;
};

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; archive: Archive }
  | { status: 'error'; kind: FailureKind };

// JSZip's public API has no uncompressed size; it lives on the entry's compressed object.
// An empty entry gets plain "" instead of a compressed object, hence the 0.
const getUncompressedSize = (entry: JSZip.JSZipObject): number =>
  (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

// Gives every folder the size of everything inside it; returns the total of this level
const sumSizes = (nodes: FileTreeNode[]): number =>
  nodes.reduce((sum, node) => {
    if (node.type === 'directory') {
      node.size = sumSizes(node.children ?? []);
    }
    return sum + (node.size ?? 0);
  }, 0);

// Entries list only the paths they contain; folders they imply have to be created here.
// Split on "\" too: some Windows tools write it, and JSZip only treats "/" as a separator.
function buildArchive(zip: JSZip): Archive {
  const root: FileTreeNode[] = [];
  const folders = new Map<string, FileTreeNode>();
  const fileIds = new Set<string>();
  let fileCount = 0;

  // Splitting on "\" can give two entries one path (or a file the path of a folder);
  // the id keeps every row's React key unique
  const uniqueFileId = (path: string) => {
    let id = `file:${path}`;
    for (let copy = 2; fileIds.has(id); copy += 1) {
      id = `file:${path}#${copy}`;
    }
    fileIds.add(id);
    return id;
  };

  // The folder at these segments (null for the archive root), created with its parents if missing
  const getFolder = (segments: string[]): FileTreeNode | null => {
    let folder: FileTreeNode | null = null;
    let path = '';
    for (const name of segments) {
      path = path ? `${path}/${name}` : name;
      let next = folders.get(path);
      if (!next) {
        next = { id: `directory:${path}`, name, path, type: 'directory', children: [] };
        folders.set(path, next);
        (folder?.children ?? root).push(next);
      }
      folder = next;
    }
    return folder;
  };

  for (const entry of Object.values(zip.files)) {
    const segments = entry.name.split(/[\\/]/).filter((segment) => segment && segment !== '.');
    if (segments.length === 0) continue;

    const modified = entry.date?.toISOString();
    if (entry.dir) {
      getFolder(segments)!.modified = modified;
      continue;
    }

    const parent = getFolder(segments.slice(0, -1));
    const path = segments.join('/');
    (parent?.children ?? root).push({
      id: uniqueFileId(path),
      name: segments[segments.length - 1],
      path,
      type: 'file',
      size: getUncompressedSize(entry),
      modified,
    });
    fileCount += 1;
  }

  const totalSize = sumSizes(root);
  return { nodes: sortFileTree(root, { field: 'name', direction: 'asc' }), fileCount, totalSize };
}

type ArchiveRowProps = {
  node: FileTreeNode;
  depth: number;
  isOpen: boolean;
  onToggle: (path: string) => void;
  formatDate: (modified?: string) => string;
};

// Memoised: toggling a folder re-renders only the rows whose props changed
const ArchiveRow = memo(function ArchiveRow({ node, depth, isOpen, onToggle, formatDate }: ArchiveRowProps) {
  const isDirectory = node.type === 'directory';

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDirectory ? isOpen : undefined}
      className={cn(ROW_GRID, 'py-1 text-sm', isDirectory && 'cursor-pointer hover:bg-accent')}
      onClick={isDirectory ? () => onToggle(node.path) : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
        <TreeItemIcon item={node} isOpen={isOpen} renderFileIcon={renderFileIcon} />
        <span className="truncate text-foreground" title={node.path}>{node.name}</span>
      </div>
      <span className="text-right text-xs text-muted-foreground">{formatFileSize(node.size)}</span>
      <span className="truncate text-xs text-muted-foreground">{formatDate(node.modified)}</span>
    </div>
  );
});

export default function ZipPreview({ projectName, filePath, fileName }: BinaryPreviewProps) {
  const { t, i18n } = useTranslation('codeEditor');
  const blobRef = useRef<Blob | null>(null);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const { expandedDirs, toggleDirectory, expandDirectories, collapseAll } = useExpandedDirectories();

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setState({ status: 'loading' });
      collapseAll();
      blobRef.current = null;

      try {
        if (!projectName) {
          throw new PreviewFailure<FailureKind>('load');
        }

        const [{ default: JSZipLib }, response] = await Promise.all([
          import('jszip'),
          api.readFileBinary(projectName, filePath, { signal: controller.signal }),
        ]);

        if (!response.ok) {
          throw new PreviewFailure<FailureKind>(failureFromStatus(response.status));
        }
        if (Number(response.headers.get('Content-Length')) > ZIP_PREVIEW_MAX_BYTES) {
          response.body?.cancel().catch(() => undefined);
          throw new PreviewFailure<FailureKind>('tooLarge');
        }

        const blob = await response.blob();
        // Checked first: a superseded load must not leave its bytes for the next file's Download
        if (controller.signal.aborted) return;
        blobRef.current = blob;
        // Covers a response without Content-Length; JSZip would otherwise copy it once more
        if (blob.size > ZIP_PREVIEW_MAX_BYTES) {
          throw new PreviewFailure<FailureKind>('tooLarge');
        }

        let zip: JSZip;
        try {
          zip = await JSZipLib.loadAsync(blob, { decodeFileName: decodeZipFileName });
        } catch (readError) {
          console.error('Error reading archive:', readError);
          // JSZip rejects the whole archive when any entry is encrypted
          const encrypted = readError instanceof Error && /encrypted/i.test(readError.message);
          throw new PreviewFailure<FailureKind>(encrypted ? 'encrypted' : 'corrupt');
        }
        if (controller.signal.aborted) return;

        const archive = buildArchive(zip);
        // A single top-level folder (the usual "zip of a folder") opens right away
        if (archive.nodes.length === 1 && archive.nodes[0].type === 'directory') {
          expandDirectories([archive.nodes[0].path]);
        }
        setState({ status: 'ready', archive });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({ status: 'error', kind: failureKindOf<FailureKind>(error) });
      }
    };

    load();

    return () => controller.abort();
  }, [projectName, filePath, collapseAll, expandDirectories]);

  // DOS timestamps are local wall-clock time, which JSZip stores as if it were UTC
  const formatDate = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });
    return (modified?: string) => (modified ? formatter.format(new Date(modified)) : '');
  }, [i18n.language]);

  // Only expanded folders contribute rows, so a huge archive stays cheap until it is opened up
  const visibleRows = useMemo(() => {
    const rows: { node: FileTreeNode; depth: number }[] = [];
    const addRows = (nodes: FileTreeNode[], depth: number) => {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (node.type === 'directory' && expandedDirs.has(node.path)) {
          addRows(node.children ?? [], depth + 1);
        }
      }
    };
    if (state.status === 'ready') {
      addRows(state.archive.nodes, 0);
    }
    return rows;
  }, [state, expandedDirs]);

  // A too-large archive was never read, so it is fetched only now
  const handleDownload = async () => {
    if (blobRef.current) {
      saveBlob(blobRef.current, fileName);
      return;
    }
    if (!projectName) return;

    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadProjectFile(projectName, filePath, fileName);
    } catch (error) {
      console.error('Error downloading archive:', error);
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  const downloadButton = (
    <div className="flex items-center justify-center gap-3">
      {downloadFailed && (
        <span className="text-xs text-destructive">{t('binaryPreview.downloadFailed', 'Download failed. Try again.')}</span>
      )}
      <Button size="sm" onClick={handleDownload} disabled={downloading}>
        {t('binaryPreview.download', 'Download')}
      </Button>
    </div>
  );

  if (state.status === 'loading') {
    return <BinaryPreviewLoading label={t('zipPreview.loading', 'Reading archive...')} />;
  }

  if (state.status === 'error') {
    const errorMessages: Record<FailureKind, string> = {
      forbidden: t('binaryPreview.errorForbidden', 'You do not have permission to read this file.'),
      notFound: t('binaryPreview.errorNotFound', 'The file no longer exists.'),
      load: t('zipPreview.errorLoad', 'The archive could not be loaded. Check your connection and try again.'),
      tooLarge: t('zipPreview.errorTooLarge', 'The archive is larger than {{limit}}, so its contents are not listed. Download it to open it locally.', {
        limit: formatFileSize(ZIP_PREVIEW_MAX_BYTES),
      }),
      corrupt: t('zipPreview.errorCorrupt', 'The archive could not be read. It may be damaged or use an unsupported format.'),
      encrypted: t('zipPreview.errorEncrypted', 'The archive is password-protected, so its contents cannot be listed.'),
    };
    // The file itself is readable in these cases, so it can still be downloaded
    const canDownload = state.kind === 'tooLarge' || state.kind === 'corrupt' || state.kind === 'encrypted';

    return <BinaryPreviewError message={errorMessages[state.kind]} action={canDownload && downloadButton} />;
  }

  const { archive } = state;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">
          {t('zipPreview.summary', 'Files: {{count}} · Size: {{size}}', {
            count: archive.fileCount,
            size: formatFileSize(archive.totalSize),
          })}
        </span>
        {downloadButton}
      </div>

      {archive.nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {t('zipPreview.empty', 'The archive is empty.')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className={cn(ROW_GRID, 'border-b border-border py-1.5 text-xs font-medium uppercase text-muted-foreground')}>
            <span>{t('zipPreview.columnName', 'Name')}</span>
            <span className="text-right">{t('zipPreview.columnSize', 'Size')}</span>
            <span>{t('zipPreview.columnModified', 'Modified')}</span>
          </div>
          <div role="tree">
            {visibleRows.map(({ node, depth }) => (
              <ArchiveRow
                key={node.id as string}
                node={node}
                depth={depth}
                isOpen={node.type === 'directory' && expandedDirs.has(node.path)}
                onToggle={toggleDirectory}
                formatDate={formatDate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
