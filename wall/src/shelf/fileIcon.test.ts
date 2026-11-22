import { IconFileDescription, IconFileMusic, IconFileSpreadsheet, IconFileText, IconMovie, IconPhoto, IconPresentation } from '@tabler/icons-react';
import { expect, it } from 'vitest';
import { fileLook } from './fileIcon';

it('picks a glyph and tint by extension', () => {
  expect(fileLook('a.pdf')).toEqual({ Icon: IconFileDescription, color: '#ff6b6b' });
  for (const n of ['a.doc', 'a.docx', 'a.rtf', 'a.odt']) expect(fileLook(n)).toEqual({ Icon: IconFileText, color: '#5aa8ff' });
  for (const n of ['a.docm', 'a.xlsm', 'a.pbix', 'a.pptm']) expect(fileLook(n).color).not.toBe('#c9c3e6');
  for (const n of ['a.xls', 'a.xlsx', 'a.csv', 'a.ods']) expect(fileLook(n)).toEqual({ Icon: IconFileSpreadsheet, color: '#3ddc84' });
  for (const n of ['a.ppt', 'a.pptx', 'a.odp']) expect(fileLook(n)).toEqual({ Icon: IconPresentation, color: '#ff9f43' });
  for (const n of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.svg', 'a.heic', 'a.tif', 'a.tiff']) expect(fileLook(n)).toEqual({ Icon: IconPhoto, color: '#b48cff' });
  for (const n of ['a.mp4', 'a.mov', 'a.mkv', 'a.avi', 'a.webm', 'a.wmv']) expect(fileLook(n)).toEqual({ Icon: IconMovie, color: '#ff6fb5' });
  for (const n of ['a.mp3', 'a.wav', 'a.flac', 'a.m4a', 'a.ogg', 'a.aac']) expect(fileLook(n)).toEqual({ Icon: IconFileMusic, color: '#ff6fb5' });
});

it('ignores case and uses the last dot', () => {
  expect(fileLook('Report.final.PDF').Icon).toBe(IconFileDescription);
});

it('gives text and unknown names the plain look', () => {
  for (const n of ['a.txt', 'a.md', 'a.log', 'a.json', 'a.xml', 'a.zzz', 'noext', 'trailing.']) expect(fileLook(n)).toEqual({ Icon: IconFileText, color: '#c9c3e6' });
});
