import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Loading and error blocks shared by the binary previews. They stay in normal flow:
// the Files-tab sidebar sizes itself to its content.

export function BinaryPreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
      {label}
    </div>
  );
}

type BinaryPreviewErrorProps = {
  message: string;
  // Shown under the message, e.g. a Download button when the file itself is readable
  action?: ReactNode;
};

export function BinaryPreviewError({ message, action }: BinaryPreviewErrorProps) {
  const { t } = useTranslation('codeEditor');

  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <h3 className="mb-2 text-lg font-medium text-foreground">
          {t('binaryPreview.errorTitle', 'Preview unavailable')}
        </h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
