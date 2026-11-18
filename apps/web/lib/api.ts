import { MuseClient } from '@muse/core/client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** Web uses the httpOnly session cookie; the x-muse-client header doubles as CSRF protection. */
export const api = new MuseClient({ baseUrl: API_URL, credentials: 'include', clientName: 'web' });
