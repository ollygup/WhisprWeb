import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Options } from 'ngx-qrcode-styling';
import { environment } from '../../environments/environment';

const QR_THEMES: Record<'dark' | 'light', Partial<Options>> = {
    dark: {
        // accent cyan dots on deep surface — clean techy look
        dotsOptions: {
            color: '#00d4ff',        // --accent dark
            type: 'rounded',
        },
        backgroundOptions: {
            color: '#0d1117',        // --surface dark (slightly lifted from --bg)
        },
        cornersSquareOptions: {
            color: '#00d4ff',        // --accent dark
            type: 'extra-rounded',
        },
        cornersDotOptions: {
            color: '#dde4ee',        // --text-primary dark (softer contrast on corners)
            type: 'dot',
        },
    },
    light: {
        // muted accent on clean white — minimal feel
        dotsOptions: {
            color: '#0099bb',        // --accent light
            type: 'rounded',
        },
        backgroundOptions: {
            color: '#ffffff',        // --surface light
        },
        cornersSquareOptions: {
            color: '#0099bb',        // --accent light
            type: 'extra-rounded',
        },
        cornersDotOptions: {
            color: '#111318',        // --text-primary light (grounded, clean)
            type: 'dot',
        },
    },
};
@Injectable({ providedIn: 'root' })
export class QRService {
    private hubUrl = environment.hubUrl;
    private doc = inject(DOCUMENT);
    private observer!: MutationObserver;

    private theme = signal<'dark' | 'light'>(this.readTheme());
    private data = signal<string>('');

    config = computed<Options>(() => ({
        width: 256,
        height: 256,
        margin: 5,
        data: this.data(),
        image: 'icon.svg',
        qrOptions: {
            errorCorrectionLevel: 'H',
        },
        imageOptions: {
            crossOrigin: 'anonymous',
            margin: 6,
            imageSize: 0.3,
            hideBackgroundDots: true,
        },
        ...QR_THEMES[this.theme()],
    }));

    constructor() {
        this.observer = new MutationObserver(() => this.theme.set(this.readTheme()));
        this.observer.observe(this.doc.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }

    updateData(groupId: string) {
        this.data.set(`${this.hubUrl}?join=${groupId}`);
    }

    ngOnDestroy() {
        this.observer.disconnect();
    }

    private readTheme(): 'dark' | 'light' {
        return this.doc.documentElement.getAttribute('data-theme') === 'light'
            ? 'light'
            : 'dark';
    }
}