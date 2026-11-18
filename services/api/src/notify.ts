/** Notifications: stored in-app, pushed live over SSE, and delivered via Web Push (VAPID) and Expo push. */
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import * as webpush from 'web-push';
import { addNotification, type Db } from '@muse/db';
import type { Bus } from '@muse/runtime';
import { log } from '@muse/runtime';
import type { ApiConfig } from './config.js';

export interface Note { title: string; body: string; url: string }

export class Notifier {
  private expo: Expo;
  private webPushOn: boolean;
  constructor(private db: Db, private bus: Bus, cfg: ApiConfig) {
    this.expo = new Expo({ accessToken: cfg.expoAccessToken });
    this.webPushOn = !!(cfg.vapidPublic && cfg.vapidPrivate);
    if (this.webPushOn) webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublic!, cfg.vapidPrivate!);
  }

  async notify(userId: string, n: Note): Promise<void> {
    await addNotification(this.db, userId, n);
    const subs = await this.db.q('SELECT id, kind, token FROM push_subscriptions WHERE user_id=$1', [userId]);
    const expoMsgs: ExpoPushMessage[] = [];
    for (const s of subs) {
      if (s.kind === 'webpush' && this.webPushOn) {
        webpush.sendNotification(s.token, JSON.stringify(n), { TTL: 3600 }).catch(async (e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) await this.db.q('DELETE FROM push_subscriptions WHERE id=$1', [s.id]);
          else log.warn({ status: e.statusCode }, 'web push failed');
        });
      } else if (s.kind === 'expo' && Expo.isExpoPushToken(s.token)) {
        expoMsgs.push({ to: s.token, title: n.title, body: n.body, data: { url: n.url }, sound: 'default' });
      }
    }
    if (expoMsgs.length) {
      for (const chunk of this.expo.chunkPushNotifications(expoMsgs)) {
        this.expo.sendPushNotificationsAsync(chunk).catch((e) => log.warn({ err: (e as Error).message }, 'expo push failed'));
      }
    }
  }
}
