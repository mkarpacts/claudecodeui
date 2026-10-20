export type CodeEditorDiffInfo = {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
};

export type CodeEditorFile = {
  name: string;
  path: string;
  projectName?: string;
  diffInfo?: CodeEditorDiffInfo | null;
  // Unique per open: a reopened file (new diff, other project) gets a fresh editor
  openId?: number;
  [key: string]: unknown;
};

// Props of a read-only preview shown for a binary file instead of the placeholder
export type BinaryPreviewProps = {
  projectName?: string;
  filePath: string;
  // Used as the name of a downloaded copy
  fileName: string;
};

export type CodeEditorSettingsState = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: string;
};
