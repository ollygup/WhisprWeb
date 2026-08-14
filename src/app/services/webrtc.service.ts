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

    // ── Transport loss grace period ──────────────────────────
    // ICE 'disconnected' fires on transient network blips that often
    // self-heal. Only treat the session as over when the link stays dead
    // for the grace window (or the connection state hard-fails).
    private readonly LINK_LOSS_GRACE_MS = 4000;
    private linkLossTimer: ReturnType<typeof setTimeout> | null = null;
    private wasConnected = false;

    // ── Public streams ────────────────────────────────────────
    private _connectionState$ = new Subject<ConnectionState>();
    private _data$ = new Subject<ArrayBuffer | string>();
    private _error$ = new Subject<string>();
    private _sessionEnded$ = new Subject<void>();

    public connectionState$ = this._connectionState$.asObservable();
    public data$ = this._data$.asObservable();
    public error$ = this._error$.asObservable();
    public sessionEnded$ = this._sessionEnded$.asObservable();

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

            if (!session) {
                if (this.rtcConnection) this.cleanup();
                return;
            }

            if (!session.isFull) return;

            // Session changed while already connected — drop the stale channel
            // so data is never routed to the previous peer, then reconnect fresh
            if (this.rtcConnection && this.peerSessionData !== session) {
                this.cleanup();
            }

            if (!this.rtcConnection) {
                this.peerSessionData = session;
                this.initializePeerConnection(session);
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
    // Pull-based flow: sender only calls sendBuffer() in response to a
    // 'request-chunk' signal from the SW — so the browser controls pace
    // and buffer management is no longer needed here.
    sendBuffer(data: ArrayBuffer): void {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(data);
        } else {
            console.log('[WebRTC] Data channel not open');
        }
    }

    sendMessage(data: string): void {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(data);
        } else {
            console.log('[WebRTC] Data channel not open');
        }
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

        this.dataChannel.onopen = () => { console.log('[WebRTC] Data channel open'); this.wasConnected = true; this._connectionState$.next('connected'); };
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
            if (state === 'connected') {
                this.wasConnected = true;
                this.clearLinkLossTimer();
                this._connectionState$.next('connected');
            }
            if (state === 'disconnected') {
                this._connectionState$.next('disconnected');
                this.startLinkLossGrace();
            }
            if (state === 'failed') {
                this._connectionState$.next('disconnected');
                if (this.wasConnected) {
                    this.endSession();
                } else {
                    this.cleanup();
                }
            }
        };
    }

    // ── Transport loss ────────────────────────────────────────
    private startLinkLossGrace(): void {
        if (!this.rtcConnection || !this.wasConnected) return;
        if (this.linkLossTimer !== null) return;
        console.log('[WebRTC] Link lost — grace period started');
        this.linkLossTimer = setTimeout(() => {
            this.linkLossTimer = null;
            console.log('[WebRTC] Link not healed — ending session');
            this.endSession();
        }, this.LINK_LOSS_GRACE_MS);
    }

    private clearLinkLossTimer(): void {
        if (this.linkLossTimer !== null) {
            clearTimeout(this.linkLossTimer);
            this.linkLossTimer = null;
        }
    }

    private endSession(): void {
        if (!this.rtcConnection || !this.wasConnected) return;
        console.log('[WebRTC] Session ended (transport lost)');
        this.clearLinkLossTimer();
        this.cleanup();
        this._sessionEnded$.next();
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
        this.clearLinkLossTimer();
        this.dataChannel?.close();
        this.rtcConnection?.close();
        this.dataChannel = undefined;
        this.rtcConnection = undefined;
        this.peerSessionData = null;
        this.wasConnected = false;
        this._connectionState$.next('idle');
    }
}