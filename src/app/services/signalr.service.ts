import { Injectable, signal } from "@angular/core";
import { Observable, Subject } from "rxjs";
import { environment } from "../../environments/environment";
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { CancelReason, FileOfferDto, PeerSession } from "../models/common.model";

@Injectable({
  providedIn: 'root'
})
export class SignalRService {
  private connection: HubConnection | null = null;
  private hubUrl = environment.hubUrl;

  private _connectionState = signal<HubConnectionState>(HubConnectionState.Disconnected);
  public connectionState = this._connectionState.asReadonly();

  // ── Whispr P2P ────────────────────────────────────────────
  private _userCode$ = new Subject<string>();
  private _peerSession = signal<PeerSession | null>(null);
  private _fileOffer = signal<FileOfferDto | null>(null);
  private _fileOfferResponse = signal<boolean | null>(null); // null = no response yet
  private _peerDisconnected$ = new Subject<void>();
  private _cancelTransfer$ = new Subject<CancelReason>();

  public onReceiveCode$ = this._userCode$.asObservable();
  public peerSession = this._peerSession.asReadonly();
  public fileOffer = this._fileOffer.asReadonly();
  public fileOfferResponse = this._fileOfferResponse.asReadonly();
  public onPeerDisconnected$ = this._peerDisconnected$.asObservable();
  public cancelTransfer$ = this._cancelTransfer$.asObservable();

  // ── WebRTC signalling ─────────────────────────────────────
  private _onOffer$ = new Subject<{ sdp: RTCSessionDescriptionInit; fromId: string }>();
  private _onAnswer$ = new Subject<{ sdp: RTCSessionDescriptionInit; fromId: string }>();
  private _onIceCandidate$ = new Subject<{ candidate: RTCIceCandidateInit; fromId: string }>();

  public onOffer$ = this._onOffer$.asObservable();
  public onAnswer$ = this._onAnswer$.asObservable();
  public onIceCandidate$ = this._onIceCandidate$.asObservable();

  // ── Connect ───────────────────────────────────────────────
  public connectAndRegister(): Observable<void> {
    return new Observable<void>(observer => {
      this.connection = new HubConnectionBuilder()
        .withUrl(this.hubUrl, { withCredentials: true })
        .configureLogging(environment.production ? LogLevel.None : LogLevel.Information)
        .withAutomaticReconnect()
        .build();

      this.setupMessageHandlers();

      this.connection.start()
        .then(() => {
          console.log('Connected to SignalR!');
          this._connectionState.set(this.connection!.state);
          return this.connection!.invoke('Register');
        })
        .then(() => {
          console.log('Registered successfully!');
          observer.next();
          observer.complete();
        })
        .catch(error => {
          console.error('Connection/Registration failed:', error);
          this._connectionState.set(HubConnectionState.Disconnected);
          observer.error(error);
        });
    });
  }

  // ── Receivers ─────────────────────────────────────────────
  private setupMessageHandlers(): void {
    if (!this.connection) return;

    this.connection.on('Error', (errorMsg: string) => {
      console.error('[SignalR] Error:', errorMsg);
    });

    this.connection.on('ReceiveCode', (code: string) => {
      console.log('[SignalR] ReceiveCode:', code);
      this._userCode$.next(code);
    });

    this.connection.on('UserJoined', (session: PeerSession) => {
      console.log('[SignalR] UserJoined:', session);
      this._peerSession.set(session);
    });

    // Peer called LeaveGroup — clear session and notify UI
    this.connection.on('PeerLeft', () => {
      console.log('[SignalR] PeerLeft');
      this._peerSession.set(null);
      this._fileOffer.set(null);
      this._fileOfferResponse.set(null);
      this._peerDisconnected$.next();
    });

    this.connection.on('ReceiveOffer', (fromId: string, sdp: RTCSessionDescriptionInit) => {
      this._onOffer$.next({ sdp, fromId });
    });

    this.connection.on('ReceiveAnswer', (fromId: string, sdp: RTCSessionDescriptionInit) => {
      this._onAnswer$.next({ sdp, fromId });
    });

    this.connection.on('ReceiveIceCandidate', (fromId: string, candidate: RTCIceCandidateInit) => {
      this._onIceCandidate$.next({ candidate, fromId });
    });

    // File transfer coordination
    this.connection.on('ReceiveFileOffer', (offer: FileOfferDto) => {
      console.log('[SignalR] ReceiveFileOffer:', offer);
      this._fileOffer.set(offer);
      this._fileOfferResponse.set(null); // reset response for new offer
    });

    this.connection.on('ReceiveFileOfferResponse', (isAccepted: boolean) => {
      console.log('[SignalR] ReceiveFileOfferResponse:', isAccepted);
      this._fileOfferResponse.set(isAccepted);
    });

    this.connection.on('ReceiveCancelFileTransfer', (reason: CancelReason) => {
      console.log('[SignalR] ReceiveCancelFileTransfer from peer');
      this._cancelTransfer$.next(reason);
    });

    this.connection.onreconnecting(() => {
      this._connectionState.set(HubConnectionState.Reconnecting);
    });

    this.connection.onreconnected(() => {
      this._connectionState.set(HubConnectionState.Connected);
    });

    this.connection.onclose(() => {
      this._connectionState.set(HubConnectionState.Disconnected);
      this._peerSession.set(null);
      this._fileOffer.set(null);
      this._fileOfferResponse.set(null);
    });
  }

  // ── Senders ───────────────────────────────────────────────
  public joinUserGroup(code: string): void {
    this.connection!.invoke('JoinUserGroup', code);
  }

  // Called when user explicitly disconnects peer from user-pane
  public leaveGroup(): void {
    this.assertConnected();
    this.connection!.invoke('LeaveGroup');
    // Clear local state immediately
    this._peerSession.set(null);
    this._fileOffer.set(null);
    this._fileOfferResponse.set(null);
  }

  async sendWebRtcOffer(targetConnectionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendOffer', targetConnectionId, sdp);
  }

  async sendWebRtcAnswer(targetConnectionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendAnswer', targetConnectionId, sdp);
  }

  async sendWebRtcIceCandidate(targetConnectionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendIceCandidate', targetConnectionId, candidate);
  }

  async sendFileOffer(targetConnectionId: string, offer: FileOfferDto): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendFileOffer', targetConnectionId, offer);
  }

  async sendFileOfferResponse(targetConnectionId: string, isAccepted: boolean): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendFileOfferResponse', targetConnectionId, isAccepted);
  }

  async sendCancelFileTransfer(targetConnectionId: string, reason : CancelReason): Promise<void> {
    this.assertConnected();
    await this.connection!.invoke('SendCancelFileTransfer', targetConnectionId, reason);
  }

  // ── Helpers ───────────────────────────────────────────────
  public getMyConnectionId(): string | null {
    return this.connection?.connectionId ?? null;
  }

  private assertConnected(): void {
    if (this.connection?.state !== HubConnectionState.Connected) {
      throw new Error('SignalR connection is not established');
    }
  }
}