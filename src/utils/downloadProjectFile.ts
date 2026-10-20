import { api } from './api';
import { saveBlob } from './saveBlob';

// Download a project file byte-for-byte through the raw content endpoint
export async function downloadProjectFile(projectName: string, filePath: string, fileName: string) {
  const response = await api.readFileBinary(projectName, filePath);

  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  saveBlob(await response.blob(), fileName);
}
