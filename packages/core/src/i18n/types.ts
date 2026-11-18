import type { en } from './en';

/** Every language must translate every key. */
export type Strings = { [K in keyof typeof en]: string };
