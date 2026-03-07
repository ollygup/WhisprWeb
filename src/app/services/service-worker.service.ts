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
      // on register, first remove all old SW
      // this ensures a new service worker is installed everytime, making sure it is the latest service worker
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
  
      const swUrl = `/sw-stream-bridge.js?interceptPath=${encodeURIComponent(environment.swInterceptPath)}`;
  
      const registration = await navigator.serviceWorker.register(swUrl);
      await navigator.serviceWorker.ready;
  
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