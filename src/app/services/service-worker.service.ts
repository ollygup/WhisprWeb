import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ServiceWorkerService {

  private ready = false;

  async register(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      console.warn('[SW] Not supported in this browser');
      return;
    }
  
    try {
      const swUrl = `/sw-stream-bridge.js?interceptPath=${encodeURIComponent(environment.swInterceptPath)}`;

      const registration = await navigator.serviceWorker.register(swUrl);
      await navigator.serviceWorker.ready;

      // First visit: the page isn't controlled until clients.claim() runs
      // during activation. Wait for control so transfers can rely on the SW
      // intercepting the fake download URL.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000);
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
        if (!navigator.serviceWorker.controller) {
          console.warn('[SW] Page not controlled by service worker after 5s');
        }
      }

      this.ready = true;
      console.log('[SW] Registered and ready');
    } catch (err) {
      console.error('[SW] Registration failed', err);
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}