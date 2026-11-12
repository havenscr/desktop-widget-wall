import {
  IconCloud,
  IconCloudFog,
  IconHazeMoon,
  IconCloudRain,
  IconCloudSnow,
  IconCloudStorm,
  IconHaze,
  IconDroplet,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import type { WeatherIconName } from './codes';

const ICONS = {
  sun: IconSun,
  moon: IconMoon,
  'cloud-sun': IconHaze,
  'cloud-moon': IconHazeMoon,
  cloud: IconCloud,
  fog: IconCloudFog,
  drizzle: IconDroplet,
  rain: IconCloudRain,
  snow: IconCloudSnow,
  storm: IconCloudStorm,
} as const;

export function WeatherIcon({ name, size = 40 }: { name: WeatherIconName; size?: number }) {
  const Icon = ICONS[name];
  return <Icon size={size} stroke={1.6} aria-hidden="true" />;
}
