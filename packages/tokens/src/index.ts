/** Design tokens shared by web and mobile. Warm cream palette, soft corners, gentle motion. */
export const palette = {
  cream50: '#FFFBF4',
  cream100: '#FBF3E6',
  cream200: '#F4E6CF',
  cream300: '#E9D4B2',
  sand500: '#C9A97C',
  cocoa700: '#6B4E31',
  cocoa900: '#3A2A1B',
  blush: '#F4A7A3',
  sage: '#8FB996',
  sky: '#8DB7D9',
  honey: '#F2C14E',
  berry: '#C9465A',
  ink: '#2A221B',
  night900: '#1B1712',
  night800: '#25201A',
  night700: '#332C24',
  night500: '#5A4E40',
} as const;

export type ThemeName = 'light' | 'dark';

export interface Theme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  userBubble: string;
  userBubbleText: string;
  agentBubble: string;
  success: string;
  warning: string;
  danger: string;
  focus: string;
}

export const themes: Record<ThemeName, Theme> = {
  light: {
    bg: palette.cream50,
    surface: '#FFFFFF',
    surfaceAlt: palette.cream100,
    border: palette.cream300,
    text: palette.ink,
    textMuted: '#7A6A58',
    accent: palette.cocoa700,
    accentText: '#FFFFFF',
    userBubble: palette.cocoa700,
    userBubbleText: '#FFFFFF',
    agentBubble: palette.cream100,
    success: '#3F7F4C',
    warning: '#9A6B00',
    danger: palette.berry,
    focus: palette.sky,
  },
  dark: {
    bg: palette.night900,
    surface: palette.night800,
    surfaceAlt: palette.night700,
    border: palette.night500,
    text: '#F6EDE0',
    textMuted: '#BCAE9C',
    accent: palette.cream200,
    accentText: palette.night900,
    userBubble: palette.cream200,
    userBubbleText: palette.night900,
    agentBubble: palette.night700,
    success: palette.sage,
    warning: palette.honey,
    danger: '#F08A9A',
    focus: palette.sky,
  },
};

export const radius = { sm: 12, md: 20, lg: 24, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = {
  family: "'Nunito', 'SF Pro Rounded', ui-rounded, system-ui, sans-serif",
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 },
  weight: { regular: '400', medium: '600', bold: '800' },
} as const;
/** Spring config used for subtle UI motion (react-native Animated + CSS cubic-bezier equivalent). */
export const motion = {
  spring: { stiffness: 220, damping: 22, mass: 1 },
  cssSpring: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
  fast: 150,
  normal: 260,
  slow: 420,
} as const;

/** Emit CSS custom properties for the web client. */
export function cssVariables(name: ThemeName): string {
  const t = themes[name];
  return Object.entries(t)
    .map(([k, v]) => `--c-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`)
    .join('\n');
}
