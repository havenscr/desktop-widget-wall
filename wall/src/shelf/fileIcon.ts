import { IconFileDescription, IconFileMusic, IconFileSpreadsheet, IconFileText, IconMovie, IconPhoto, IconPresentation, type Icon } from '@tabler/icons-react';

/** The glyph and tint a recent file gets, chosen from the extension in its name. */
export interface FileLook {
  Icon: Icon;
  color: string;
}

const PINK = '#ff6fb5';
const LOOKS: { exts: string[]; look: FileLook }[] = [
  { exts: ['pdf'], look: { Icon: IconFileDescription, color: '#ff6b6b' } },
  { exts: ['doc', 'docx', 'docm', 'dot', 'dotx', 'rtf', 'odt'], look: { Icon: IconFileText, color: '#5aa8ff' } },
  { exts: ['xls', 'xlsx', 'xlsm', 'xlsb', 'xltx', 'csv', 'ods', 'pbix', 'pbip', 'pbit'], look: { Icon: IconFileSpreadsheet, color: '#3ddc84' } },
  { exts: ['ppt', 'pptx', 'pptm', 'potx', 'odp'], look: { Icon: IconPresentation, color: '#ff9f43' } },
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff'], look: { Icon: IconPhoto, color: '#b48cff' } },
  { exts: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv'], look: { Icon: IconMovie, color: PINK } },
  { exts: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'], look: { Icon: IconFileMusic, color: PINK } },
];
const OTHER: FileLook = { Icon: IconFileText, color: '#c9c3e6' };

/** The look for a file name: by the text after its last dot, ignoring case; anything unknown gets the plain text look. */
export function fileLook(name: string): FileLook {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return LOOKS.find((l) => l.exts.includes(ext))?.look ?? OTHER;
}
