import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';
import { Button } from '../../../../shared/view/ui/Button';
import { saveBlob } from '../../../../utils/saveBlob';
import type { BinaryPreviewProps } from '../../types/types';
import { failureFromStatus, failureKindOf, PreviewFailure, type FetchFailureKind } from '../../utils/binaryPreview';
import { BinaryPreviewError, BinaryPreviewLoading } from './BinaryPreviewStatus';

type FailureKind = FetchFailureKind | 'render';
type PreviewState = { status: 'loading' | 'ready' } | { status: 'error'; kind: FailureKind };

// Only plain web and mail links stay clickable; anything else (javascript:, file:, …) is stripped
const SAFE_HREF = /^(https?:|mailto:|#)/i;
// Images and fonts are inlined as data: URLs; any other url() would let a document call out
const EXTERNAL_CSS_URL = /url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi;

// The rendered markup and its styles come from the document itself — neutralise what can escape it
function sanitizeRenderedDocument(root: HTMLElement) {
  root.querySelectorAll('a[href]').forEach((link) => {
    if (!SAFE_HREF.test(link.getAttribute('href') ?? '')) {
      link.removeAttribute('href');
    }
  });
  root.querySelectorAll('img[src]').forEach((image) => {
    if (!image.getAttribute('src')?.startsWith('data:')) {
      image.removeAttribute('src');
    }
  });
  root.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent ?? '').replace(EXTERNAL_CSS_URL, 'none');
  });
  root.querySelectorAll<HTMLElement>('[style*="url("]').forEach((element) => {
    element.setAttribute('style', (element.getAttribute('style') ?? '').replace(EXTERNAL_CSS_URL, 'none'));
  });
}

export default function DocxPreview({ projectName, filePath, fileName }: BinaryPreviewProps) {
  const { t } = useTranslation('codeEditor');
  const hostRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // A shadow root keeps the document's generated CSS from leaking into the app
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const controller = new AbortController();

    const render = async () => {
      setState({ status: 'loading' });
      blobRef.current = null;

      try {
        if (!projectName) {
          throw new PreviewFailure<FailureKind>('load');
        }

        // docx-preview is loaded on demand so it stays out of the main bundle
        const [{ renderAsync }, response] = await Promise.all([
          import('docx-preview'),
          api.readFileBinary(projectName, filePath, { signal: controller.signal }),
        ]);

        if (!response.ok) {
          throw new PreviewFailure<FailureKind>(failureFromStatus(response.status));
        }

        const blob = await response.blob();
        // Checked first: a superseded load must not leave its bytes for the next file's Download
        if (controller.signal.aborted) return;
        blobRef.current = blob;

        // renderAsync cannot be cancelled: render off-screen and swap in only if still current
        const staging = document.createElement('div');
        try {
          await renderAsync(blob, staging, undefined, {
            renderAltChunks: false,
            // docx-preview never revokes the object URLs it creates; base64 avoids leaking them
            useBase64URL: true,
          });
        } catch (renderError) {
          console.error('Error rendering document:', renderError);
          throw new PreviewFailure<FailureKind>('render');
        }
        if (controller.signal.aborted) return;

        sanitizeRenderedDocument(staging);
        shadow.replaceChildren(staging);
        setState({ status: 'ready' });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        shadow.replaceChildren();
        setState({ status: 'error', kind: failureKindOf<FailureKind>(error) });
      }
    };

    render();

    return () => {
      controller.abort();
      shadow.replaceChildren();
    };
  }, [projectName, filePath]);

  const handleDownload = () => {
    if (blobRef.current) {
      saveBlob(blobRef.current, fileName);
    }
  };

  const errorMessages: Record<FailureKind, string> = {
    forbidden: t('binaryPreview.errorForbidden', 'You do not have permission to read this file.'),
    notFound: t('binaryPreview.errorNotFound', 'The file no longer exists.'),
    load: t('docxPreview.errorLoad', 'The document could not be loaded. Check your connection and try again.'),
    render: t('docxPreview.errorRender', 'This document could not be rendered. It may be damaged — download it and open it in Word.'),
  };

  return (
    <div className="h-full w-full overflow-auto bg-muted">
      <div ref={hostRef} data-docx-preview="" />

      {state.status === 'loading' && <BinaryPreviewLoading label={t('docxPreview.loading', 'Rendering document...')} />}

      {state.status === 'error' && (
        <BinaryPreviewError
          message={errorMessages[state.kind]}
          action={state.kind === 'render' && (
            <Button size="sm" onClick={handleDownload}>
              {t('binaryPreview.download', 'Download')}
            </Button>
          )}
        />
      )}
    </div>
  );
}
