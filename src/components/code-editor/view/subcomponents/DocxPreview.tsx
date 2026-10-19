import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';
import { saveBlob } from '../../../../utils/saveBlob';

export type DocxPreviewProps = {
  projectName?: string;
  filePath: string;
};

type FailureKind = 'forbidden' | 'notFound' | 'load' | 'render';
type PreviewState = { status: 'loading' | 'ready' } | { status: 'error'; kind: FailureKind };

class PreviewFailure extends Error {
  constructor(readonly kind: FailureKind) {
    super(kind);
  }
}

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

const failureFromStatus = (status: number): FailureKind => {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  return 'load';
};

export default function DocxPreview({ projectName, filePath }: DocxPreviewProps) {
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
          throw new PreviewFailure('load');
        }

        // docx-preview is loaded on demand so it stays out of the main bundle
        const [{ renderAsync }, response] = await Promise.all([
          import('docx-preview'),
          api.readFileBinary(projectName, filePath, { signal: controller.signal }),
        ]);

        if (!response.ok) {
          throw new PreviewFailure(failureFromStatus(response.status));
        }

        const blob = await response.blob();
        blobRef.current = blob;
        if (controller.signal.aborted) return;

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
          throw new PreviewFailure('render');
        }
        if (controller.signal.aborted) return;

        sanitizeRenderedDocument(staging);
        shadow.replaceChildren(staging);
        setState({ status: 'ready' });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (!(error instanceof PreviewFailure)) {
          console.error('Error loading document:', error);
        }
        shadow.replaceChildren();
        setState({ status: 'error', kind: error instanceof PreviewFailure ? error.kind : 'load' });
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
      saveBlob(blobRef.current, filePath.split(/[\\/]/).pop() || 'document.docx');
    }
  };

  const errorMessages: Record<FailureKind, string> = {
    forbidden: t('docxPreview.errorForbidden', 'You do not have permission to read this file.'),
    notFound: t('docxPreview.errorNotFound', 'The file no longer exists.'),
    load: t('docxPreview.errorLoad', 'The document could not be loaded. Check your connection and try again.'),
    render: t('docxPreview.errorRender', 'This document could not be rendered. It may be damaged — download it and open it in Word.'),
  };

  // Status blocks stay in normal flow: the Files-tab sidebar sizes itself to its content
  return (
    <div className="h-full w-full overflow-auto bg-muted">
      <div ref={hostRef} data-docx-preview="" />

      {state.status === 'loading' && (
        <div className="flex h-full items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
          {t('docxPreview.loading', 'Rendering document...')}
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <h3 className="mb-2 text-lg font-medium text-foreground">
              {t('docxPreview.errorTitle', 'Preview unavailable')}
            </h3>
            <p className="text-sm text-muted-foreground">{errorMessages[state.kind]}</p>
            {state.kind === 'render' && (
              <button
                type="button"
                onClick={handleDownload}
                className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t('docxPreview.download', 'Download')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
