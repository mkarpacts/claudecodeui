import { cn } from '../../../lib/utils';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';

export function renderFileIcon(filename: string) {
  const { icon: Icon, color } = getFileIconData(filename);
  return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
}
