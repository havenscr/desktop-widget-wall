import { expect, it } from 'vitest';
import { describeWeather } from './codes';

it('maps common codes', () => {
  expect(describeWeather(0)).toEqual({ label: 'Clear', icon: 'sun' });
  expect(describeWeather(3)).toEqual({ label: 'Overcast', icon: 'cloud' });
  expect(describeWeather(63)).toEqual({ label: 'Rain', icon: 'rain' });
  expect(describeWeather(73).icon).toBe('snow');
  expect(describeWeather(95).icon).toBe('storm');
  expect(describeWeather(45).icon).toBe('fog');
});

it('uses night icons after dark', () => {
  expect(describeWeather(0, false).icon).toBe('moon');
  expect(describeWeather(2, false).icon).toBe('cloud-moon');
  expect(describeWeather(3, false).icon).toBe('cloud');
});

it('never throws on unknown codes', () => {
  expect(describeWeather(1234)).toEqual({ label: 'Unknown', icon: 'cloud' });
});
