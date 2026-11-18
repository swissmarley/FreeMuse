import { useColorScheme } from 'react-native';
import { radius, space, themes, type Theme } from '@muse/tokens';
import { useMuse } from './store';

export function useTheme(): Theme & { radius: typeof radius; space: typeof space } {
  const sys = useColorScheme();
  const { s } = useMuse();
  const pref = s.me?.settings.theme ?? 'system';
  const name = pref === 'system' ? (sys === 'dark' ? 'dark' : 'light') : pref;
  return { ...themes[name], radius, space };
}
