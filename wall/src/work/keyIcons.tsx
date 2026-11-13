import {
  IconAppWindow,
  IconArrowBackUp,
  IconBrush,
  IconCamera,
  IconClipboardList,
  IconCode,
  IconCopy,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconGauge,
  IconKeyboard,
  IconLock,
  IconMicrophone,
  IconPlayerPlay,
  IconRefresh,
  IconScreenshot,
  IconSearch,
  type Icon,
} from '@tabler/icons-react';

/** The icon names `keys.json` may use. Any other name draws the keyboard. */
export const KEY_ICONS: Record<string, Icon> = {
  refresh: IconRefresh,
  screenshot: IconScreenshot,
  camera: IconCamera,
  clipboard: IconClipboardList,
  desktop: IconDeviceDesktop,
  brush: IconBrush,
  gauge: IconGauge,
  code: IconCode,
  copy: IconCopy,
  save: IconDeviceFloppy,
  undo: IconArrowBackUp,
  search: IconSearch,
  lock: IconLock,
  mic: IconMicrophone,
  play: IconPlayerPlay,
  window: IconAppWindow,
  keyboard: IconKeyboard,
};

export function KeyIcon({ name, size = 22 }: { name: string; size?: number }) {
  const C = KEY_ICONS[name] ?? IconKeyboard;
  return <C size={size} stroke={1.8} aria-hidden="true" />;
}
