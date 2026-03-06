import { ApplicationConfig, provideBrowserGlobalErrorListeners, APP_INITIALIZER, inject, provideAppInitializer  } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ServiceWorkerService } from './services/service-worker.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // blocks entire app from rendering until everything inside is resolved 
    provideAppInitializer(() => {
      const swService = inject(ServiceWorkerService);
      return swService.register();
    })
  ]
};