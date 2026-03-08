import { effect, Injectable, OnDestroy } from '@angular/core';
import { SignalRService } from './signalr.service';
import { Subject, Subscription } from 'rxjs';
import { PeerSession } from '../models/common.model';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

@Injectable({
    providedIn: 'root'
})
export class WebrtcService implements OnDestroy {

    private rtcConnection?: RTCPeerConnection;
    private dataChannel?: RTCDataChannel;
    private peerSessionData: PeerSession | null = null;
    private subscription = new Subscription();

    // ── Buffer thresholds ─────────────────────────────────────
    private readonly BUFFER_MAX = 8 * 1024 * 1024; // 8MB — pause sending
    private readonly BUFFER_THRESHOLD = 1 * 1024 * 1024; // 1MB — resume sending

    // ── Public streams ────────────────────────────────────────
    private _connectionState$ = new Subject<ConnectionState>();
    private _data$ = new Subject<ArrayBuffer | string>();
    private _error$ = new Subject<string>();

    public connectionState$ = this._connectionState$.asObservable();
    public data$ = this._data$.asObservable();
    public error$ = this._error$.asObservable();

    private readonly RTC_CONFIG: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    };

    constructor(private signalRService: SignalRService) {
        effect(() => {
            const session = this.signalRService.peerSession();

            if (session?.isFull && !this.rtcConnection) {
                this.peerSessionData = session;
                this.initializePeerConnection(session);
            }

            if (!session && this.rtcConnection) {
                this.cleanup();
            }
        });

        this.setupSignalRBridge();
    }

    ngOnDestroy() {
        this.subscription.unsubscribe();
        this.cleanup();
    }

    // ── Stats — exposed for user-pane polling ─────────────────
    async getStats(): Promise<RTCStatsReport | null> {
        if (!this.rtcConnection) return null;
        try {
            return await this.rtcConnection.getStats();
        } catch {
            return null;
        }
    }

    // ── Send ──────────────────────────────────────────────────
    sendBuffer(data: ArrayBuffer): void {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(data);
        } else {
            console.warn('[WebRTC] Data channel not open');
        }
    }

    sendMessage(data: string): void {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(data);
        } else {
            console.warn('[WebRTC] Data channel not open');
        }
    }

    // ── Buffer helpers ────────────────────────────────────────
    getBufferedAmount(): number {
        return this.dataChannel?.bufferedAmount ?? 0;
    }

    waitForBufferDrain(): Promise<void> {
        if (!this.dataChannel) return Promise.resolve();
        if (this.dataChannel.bufferedAmount < this.BUFFER_MAX) return Promise.resolve();

        return new Promise(resolve => {
            const handler = () => {
                // Once fired, remove itself so it doesn't trigger again
                this.dataChannel!.removeEventListener('bufferedamountlow', handler);
                // Calling resolve() is what unfreezes the await in startSend()
                resolve();
            };
            // addEventListener registers handler into the browser's internal event registry.
            // The browser continuously monitors bufferedAmount as it sends packets over the network.
            // When bufferedAmount drops below bufferedAmountLowThreshold (BUFFER_THRESHOLD),
            // the browser itself fires the 'bufferedamountlow' event — which triggers handler() function,
            // which calls resolve(), unfreezing the await in startSend().
            this.dataChannel!.addEventListener('bufferedamountlow', handler);
        });
    }

    // ── Init ──────────────────────────────────────────────────
    private initializePeerConnection(session: PeerSession): void {
        this.rtcConnection = new RTCPeerConnection(this.RTC_CONFIG);

        const myId = this.signalRService.getMyConnectionId();
        const isOfferer = session.userA?.connectionId === myId;
        const targetId = isOfferer
            ? session.userB!.connectionId
            : session.userA!.connectionId;

        this.setupConnectionHandlers(targetId);

        if (isOfferer) {
            this.createDataChannelAsOfferer();
            this.createAndSendOffer(targetId);
        } else {
            this.rtcConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannelHandlers();
            };
        }
    }

    // ── Data channel ──────────────────────────────────────────
    private createDataChannelAsOfferer(): void {
        this.dataChannel = this.rtcConnection!.createDataChannel('whispr', { ordered: true });
        this.setupDataChannelHandlers();
    }

    private setupDataChannelHandlers(): void {
        if (!this.dataChannel) return;

        this.dataChannel.binaryType = 'arraybuffer';

        // Tell the browser to fire bufferedamountlow when buffer drains to 1MB
        this.dataChannel.bufferedAmountLowThreshold = this.BUFFER_THRESHOLD;

        this.dataChannel.onopen = () => { console.log('[WebRTC] Data channel open'); this._connectionState$.next('connected'); };
        this.dataChannel.onclose = () => { console.log('[WebRTC] Data channel closed'); this._connectionState$.next('disconnected'); };
        this.dataChannel.onerror = (err) => {
            this._error$.next('Data channel error');
            console.log('[WebRTC] Data channel error:', err);
            this.cleanup();
        };
        this.dataChannel.onmessage = (event) => this._data$.next(event.data);
    }

    // ── Offer ─────────────────────────────────────────────────
    private async createAndSendOffer(targetId: string): Promise<void> {
        try {
            const offer = await this.rtcConnection!.createOffer();
            await this.rtcConnection!.setLocalDescription(offer);
            await this.signalRService.sendWebRtcOffer(targetId, offer);
        } catch (err) {
            this._error$.next('Failed to create offer');
            console.error('[WebRTC] Offer error:', err);
            this.cleanup();
        }
    }

    // ── ICE + connection state ────────────────────────────────
    private setupConnectionHandlers(targetId: string): void {
        this.rtcConnection!.onicecandidate = async (event) => {
            if (event.candidate) {
                try {
                    await this.signalRService.sendWebRtcIceCandidate(targetId, event.candidate.toJSON());
                } catch (err) {
                    console.error('[WebRTC] Failed to send ICE candidate:', err);
                }
            }
        };

        this.rtcConnection!.onconnectionstatechange = () => {
            const state = this.rtcConnection?.connectionState;
            console.log('[WebRTC] Connection state:', state);
            if (state === 'connecting') this._connectionState$.next('connecting');
            if (state === 'connected') this._connectionState$.next('connected');
            if (state === 'disconnected' || state === 'failed') {
                this._connectionState$.next('disconnected');
                setTimeout(() => this.cleanup(), 2000);
            }
        };
    }

    // ── SignalR bridge ────────────────────────────────────────
    private setupSignalRBridge(): void {
        this.subscription.add(
            this.signalRService.onOffer$.subscribe(async ({ sdp, fromId }) => {
                if (!this.rtcConnection) return;
                try {
                    await this.rtcConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                    const answer = await this.rtcConnection.createAnswer();
                    await this.rtcConnection.setLocalDescription(answer);
                    await this.signalRService.sendWebRtcAnswer(fromId, answer);
                } catch (err) {
                    this._error$.next('Failed to handle offer');
                    console.error('[WebRTC] Answer error:', err);
                    this.cleanup();
                }
            })
        );

        this.subscription.add(
            this.signalRService.onAnswer$.subscribe(async ({ sdp }) => {
                if (!this.rtcConnection) return;
                try {
                    await this.rtcConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                } catch (err) {
                    this._error$.next('Failed to handle answer');
                    console.error('[WebRTC] Set remote answer error:', err);
                    this.cleanup();
                }
            })
        );

        this.subscription.add(
            this.signalRService.onIceCandidate$.subscribe(async ({ candidate }) => {
                if (!this.rtcConnection) return;
                try {
                    await this.rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('[WebRTC] Failed to add ICE candidate:', err);
                    this.cleanup();
                }
            })
        );
    }

    // ── Cleanup ───────────────────────────────────────────────
    private cleanup(): void {
        this.dataChannel?.close();
        this.rtcConnection?.close();
        this.dataChannel = undefined;
        this.rtcConnection = undefined;
        this.peerSessionData = null;
        this._connectionState$.next('idle');
    }
}