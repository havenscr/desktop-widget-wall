export type WeatherIconName =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud-moon'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

export interface WeatherLook {
  label: string;
  icon: WeatherIconName;
}

/** WMO weather code to a label and an icon name. Pure; unknown codes read "Unknown". */
export function describeWeather(code: number, isDay = true): WeatherLook {
  switch (code) {
    case 0:
      return { label: 'Clear', icon: isDay ? 'sun' : 'moon' };
    case 1:
      return { label: 'Mostly clear', icon: isDay ? 'sun' : 'moon' };
    case 2:
      return { label: 'Partly cloudy', icon: isDay ? 'cloud-sun' : 'cloud-moon' };
    case 3:
      return { label: 'Overcast', icon: 'cloud' };
    case 45:
    case 48:
      return { label: 'Fog', icon: 'fog' };
    case 51:
    case 53:
    case 55:
      return { label: 'Drizzle', icon: 'drizzle' };
    case 56:
    case 57:
      return { label: 'Freezing drizzle', icon: 'drizzle' };
    case 61:
      return { label: 'Light rain', icon: 'rain' };
    case 63:
      return { label: 'Rain', icon: 'rain' };
    case 65:
      return { label: 'Heavy rain', icon: 'rain' };
    case 66:
    case 67:
      return { label: 'Freezing rain', icon: 'rain' };
    case 71:
      return { label: 'Light snow', icon: 'snow' };
    case 73:
      return { label: 'Snow', icon: 'snow' };
    case 75:
      return { label: 'Heavy snow', icon: 'snow' };
    case 77:
      return { label: 'Snow grains', icon: 'snow' };
    case 80:
      return { label: 'Light showers', icon: 'rain' };
    case 81:
      return { label: 'Showers', icon: 'rain' };
    case 82:
      return { label: 'Heavy showers', icon: 'rain' };
    case 85:
    case 86:
      return { label: 'Snow showers', icon: 'snow' };
    case 95:
    case 96:
    case 99:
      return { label: 'Thunderstorm', icon: 'storm' };
    default:
      return { label: 'Unknown', icon: 'cloud' };
  }
}
