import { IconBookmark, IconBroadcast, IconCrop, IconDeviceDesktopOff, IconMicrophone, IconMicrophoneOff, IconPlayerStopFilled, IconPresentation, IconScreenShare, IconUser, IconUsers, IconVideo, IconVideoOff, type Icon } from '@tabler/icons-react';
import type { ShownAction } from './studioSlots';

/** The icon of each studio key action. */
export const SLOT_ICON: Record<ShownAction, Icon> = {
  scene1: IconUser,
  scene2: IconPresentation,
  scene3: IconUsers,
  scene4: IconScreenShare,
  mute: IconMicrophoneOff,
  camera: IconVideoOff,
  share: IconScreenShare,
  golive: IconBroadcast,
  end: IconPlayerStopFilled,
  solo: IconUser,
  two: IconUsers,
  mark: IconBookmark,
  snip: IconCrop,
  hide: IconDeviceDesktopOff,
};

/** The icon of a toggle key when its state is known to be off: the key now turns the mic or camera back on. */
export const ICON_WHEN_OFF: Partial<Record<ShownAction, Icon>> = { mute: IconMicrophone, camera: IconVideo };
