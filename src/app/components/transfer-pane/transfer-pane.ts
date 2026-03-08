import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, effect, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CancelReason, FileOfferDto, PeerSession, TransferStatus } from '../../models/common.model';
import { SignalRService } from '../../services/signalr.service';
import { SwalService } from '../../services/swal.service';
import { WebrtcService } from '../../services/webrtc.service';
import { transferStatusLabel } from '../../models/common.model';

type DataMessage = { type: 'transfer-complete' | 'request-chunk' };

const CHUNK_SIZE = 64 * 1024; // 64KB

@Component({
  selector: 'app-transfer-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transfer-pane.html',
  styleUrl: './transfer-pane.scss'
})
export class TransferPane implements OnInit, OnDestroy {

  protected readonly statusLabel = transferStatusLabel;

  private peerSession: PeerSession | null = null;
  private sub = new Subscription();
  private selectedFile: File | null = null;

  // ── Stream bridge state ───────────────────────────────────
  private downloadId: string | null = null;
  private bytesReceived = 0;

  // ── Pull-based send state ─────────────────────────────────
  // Chunks are sent one at a time in response to 'request-chunk' signals
  // from the receiver's SW.
  private currentChunkIndex = 0;
  private totalChunks = 0;
  private pendingChunkRequest = false;
  private chunkRequestTimeout: number | null = null;
  private readonly RECEIVER_IDLE_MS = 1000;

  // ── Peer connected gate ───────────────────────────────────
  peerConnected = signal(false);

  // ── Sender state ──────────────────────────────────────────
  sendStatus = signal<TransferStatus>('idle');
  sendProgress = signal(0);
  fileName = signal<string | null>(null);
  fileSize = signal<string | null>(null);
  isDragging = signal(false);
  peerReady = signal(false);
  peerRejected = signal(false);
  // True when no request-chunk has arrived after RECEIVER_IDLE_MS —
  // receiver likely paused from their browser download manager
  senderIdleHint = signal(false);

  // ── Receiver state ────────────────────────────────────────
  incomingFileOffer = signal<FileOfferDto | null>(null);
  receiveStatus = signal<TransferStatus>('idle');
  receiveProgress = signal(0);
  offerCancelledByPeer = false;

  // ── Receiver's download popup ─────────────────────────────
  private swalRef: any = null;

  constructor(
    private webrtcService: WebrtcService,
    private signalRService: SignalRService,
    private swalService: SwalService
  ) {
    effect(() => {
      this.peerSession = this.signalRService.peerSession();
      this.peerConnected.set(this.peerSession?.isFull ?? false);

      if (!this.peerSession) {
        this.resetSend();
        this.resetReceive();
      }
    });

    effect(() => {
      const offer = this.signalRService.fileOffer();
      if (!offer) return;
      this.incomingFileOffer.set(offer);
      this.bytesReceived = 0;
      this.receiveStatus.set('connected');
      this.promptFileOffer(offer);
    });
  }

  ngOnInit() {
    this.sub.add(
      this.webrtcService.data$.subscribe(data => this.handleIncoming(data))
    );

    this.sub.add(
      this.signalRService.onPeerDisconnected$.subscribe(() => {
        if (this.downloadId) {
          navigator.serviceWorker.controller?.postMessage({
            id: this.downloadId,
            done: true
          });
        }
        this.resetSend();
        this.resetReceive();
        this.peerConnected.set(false);
      })
    );

    this.sub.add(
      this.signalRService.fileOfferResponse$.subscribe((response) => {
        if (response === true) {
          this.peerReady.set(true);
          this.peerRejected.set(false);
          this.startSend();
        } else {
          this.peerRejected.set(true);
          this.peerReady.set(false);
          this.sendStatus.set('idle');
        }
      })
    );

    this.sub.add(
      this.signalRService.cancelTransfer$.subscribe((reason) => {
        this.cancelledByPeer(reason);
      })
    );

    navigator.serviceWorker.addEventListener('message', (event) => {
      // SW pull() fired — forward chunk request to sender via WebRTC
      if (event.data?.type === 'request-chunk' && event.data?.id === this.downloadId) {
        this.webrtcService.sendMessage(JSON.stringify({ type: 'request-chunk' }));
      }

      // Browser cancelled from download bar
      if (event.data?.type === 'transfer-cancelled' && event.data?.id === this.downloadId) {
        this.downloadId = null;
        this.resetReceive();
        const remoteConnectionId = this.getRemoteConnectionId();
        if (remoteConnectionId) this.signalRService.sendCancelFileTransfer(remoteConnectionId, 'user-cancelled');
      }

      // Stream enqueue threw — bad state
      if (event.data?.type === 'transfer-failed' && event.data?.id === this.downloadId) {
        this.downloadId = null;
        this.receiveStatus.set('error');
        const remoteConnectionId = this.getRemoteConnectionId();
        if (remoteConnectionId) this.signalRService.sendCancelFileTransfer(remoteConnectionId, 'transfer-failed');
      }
    });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  // ── Receiver: Swal prompt ─────────────────────────────────
  private async promptFileOffer(offer: FileOfferDto): Promise<void> {
    this.offerCancelledByPeer = false;
    this.swalRef = this.swalService.showFileOfferPrompt(offer.name, this.formatBytes(offer.size));

    const result = await this.swalRef;
    this.swalRef = null;

    if (this.offerCancelledByPeer) return;

    if (result.isConfirmed) {
      this.acceptOffer(offer);
    } else {
      this.dismissOffer();
    }
  }

  // ── Receiver: accept — open SW stream + notify sender ─────
  private acceptOffer(offer: FileOfferDto): void {
    this.downloadId = crypto.randomUUID();

    const name = encodeURIComponent(offer.name);
    const a = document.createElement('a');
    a.href = `${environment.swInterceptPath}${this.downloadId}?name=${name}&size=${offer.size}`;
    a.click();

    this.receiveStatus.set('active');
    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOfferResponse(targetId, true);
  }

  // ── Receiver: decline — notify sender ─────────────────────
  dismissOffer(): void {
    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOfferResponse(targetId, false);
    this.resetReceive();
  }

  // ── Incoming data ─────────────────────────────────────────
  private handleIncoming(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data) as DataMessage;

        if (msg.type === 'request-chunk') {
          this.sendNextChunk();
          return;
        }

        if (msg.type === 'transfer-complete') {
          this.finaliseDownload();
        }
      } catch { console.error('[Transfer] Failed to parse message'); }
      return;
    }

    if (this.receiveStatus() !== 'active' || !this.downloadId) return;

    const chunkSize = data.byteLength;
    navigator.serviceWorker.controller?.postMessage(
      { id: this.downloadId, chunk: data, done: false },
      [data]
    );

    this.bytesReceived += chunkSize;
    const offer = this.incomingFileOffer();
    if (offer) {
      this.receiveProgress.set(Math.min(
        Math.round((this.bytesReceived / offer.size) * 100), 99
      ));
    }
  }

  // ── Receiver: finalise — tell SW to close the stream ──────
  private finaliseDownload(): void {
    navigator.serviceWorker.controller?.postMessage(
      { id: this.downloadId, done: true }
    );
    this.downloadId = null;
    this.bytesReceived = 0;
    this.receiveStatus.set('done');
    this.receiveProgress.set(100);
  }

  // ── Sender: file pick ─────────────────────────────────────
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.setFile(file);
    input.value = '';
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave() { this.isDragging.set(false); }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    this.setFile(file);
  }

  private setFile(file: File): void {
    this.selectedFile = file;
    this.fileName.set(file.name);
    this.fileSize.set(this.formatBytes(file.size));
    this.peerReady.set(false);
    this.peerRejected.set(false);
    this.sendStatus.set('idle');
  }

  // ── Sender: send offer ────────────────────────────────────
  sendOffer(): void {
    if (!this.selectedFile) return;

    const totalChunks = Math.ceil(this.selectedFile.size / CHUNK_SIZE);
    const offer: FileOfferDto = {
      type: 'file-offer',
      name: this.selectedFile.name,
      size: this.selectedFile.size,
      mimeType: this.selectedFile.type || 'application/octet-stream',
      totalChunks
    };

    this.peerRejected.set(false);
    this.sendStatus.set('idle');
    this.sendProgress.set(0);

    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOffer(targetId, offer);

    this.sendStatus.set('connected');
  }

  // ── Sender: prepare — actual sending is event-driven ─────
  startSend(): void {
    if (!this.selectedFile) return;

    this.sendStatus.set('active');
    this.sendProgress.set(0);
    this.currentChunkIndex = 0;
    this.totalChunks = Math.ceil(this.selectedFile.size / CHUNK_SIZE);

    // Flush any request-chunk that arrived before SignalR completed
    if (this.pendingChunkRequest) {
      this.pendingChunkRequest = false;
      this.sendNextChunk();
    }
  }

  // ── Sender: send one chunk per request-chunk signal ───────
  private async sendNextChunk(): Promise<void> {
    // Chunk requested — receiver is active, clear the idle hint and timer
    if (this.chunkRequestTimeout !== null) {
      clearTimeout(this.chunkRequestTimeout);
      this.chunkRequestTimeout = null;
    }
    this.senderIdleHint.set(false);

    if (!this.selectedFile || this.totalChunks === 0) {
      this.pendingChunkRequest = true;
      return;
    }

    if (this.currentChunkIndex >= this.totalChunks) {
      this.webrtcService.sendMessage(JSON.stringify({ type: 'transfer-complete' }));
      this.sendStatus.set('done');
      return;
    }

    const start = this.currentChunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, this.selectedFile.size);
    const chunk = await this.selectedFile.slice(start, end).arrayBuffer();

    this.webrtcService.sendBuffer(chunk);
    this.currentChunkIndex++;
    this.sendProgress.set(Math.round((this.currentChunkIndex / this.totalChunks) * 100));

    // Start watching — if no request arrives within RECEIVER_IDLE_MS,
    // the receiver has likely paused from their browser download manager
    this.chunkRequestTimeout = setTimeout(() => {
      this.chunkRequestTimeout = null;
      if (this.sendStatus() === 'active') {
        this.senderIdleHint.set(true);
      }
    }, this.RECEIVER_IDLE_MS);
  }

  // ── Resets ────────────────────────────────────────────────
  resetSend() {
    if (this.chunkRequestTimeout !== null) {
      clearTimeout(this.chunkRequestTimeout);
      this.chunkRequestTimeout = null;
    }
    this.sendStatus.set('idle');
    this.sendProgress.set(0);
    this.fileName.set(null);
    this.fileSize.set(null);
    this.selectedFile = null;
    this.peerReady.set(false);
    this.peerRejected.set(false);
    this.senderIdleHint.set(false);
    this.currentChunkIndex = 0;
    this.totalChunks = 0;
    this.pendingChunkRequest = false;
  }

  resetReceive() {
    this.incomingFileOffer.set(null);
    this.receiveStatus.set('idle');
    this.receiveProgress.set(0);
    this.downloadId = null;
    this.bytesReceived = 0;
  }

  // ── Cancel ────────────────────────────────────────────────
  cancelSend(): void {
    const remoteConnectionId = this.getRemoteConnectionId();
    if (remoteConnectionId) this.signalRService.sendCancelFileTransfer(remoteConnectionId, 'user-cancelled');
    this.sendStatus.set('self-cancelled');
  }

  cancelReceive(): void {
    if (this.downloadId) {
      navigator.serviceWorker.controller?.postMessage({ id: this.downloadId, cancel: true });
      this.downloadId = null;
    }
    const remoteConnectionId = this.getRemoteConnectionId();
    if (remoteConnectionId) this.signalRService.sendCancelFileTransfer(remoteConnectionId, 'user-cancelled');
    this.receiveStatus.set('self-cancelled');
  }

  private cancelledByPeer(reason: CancelReason): void {
    if (this.swalRef) {
      this.offerCancelledByPeer = true;
      this.swalService.closeAll();
      this.swalRef = null;
      this.resetReceive();
    }

    if (this.downloadId) {
      navigator.serviceWorker.controller?.postMessage({ id: this.downloadId, cancel: true });
      this.downloadId = null;
      this.receiveStatus.set(reason === 'transfer-failed' ? 'error' : 'cancelled');
    } else {
      this.sendStatus.set(reason === 'transfer-failed' ? 'error' : 'cancelled');
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }

  private getRemoteConnectionId(): string | null {
    if (!this.peerSession) return null;
    const myId = this.signalRService.getMyConnectionId();
    if (!myId) return null;
    if (this.peerSession.userA?.connectionId === myId) return this.peerSession.userB?.connectionId ?? null;
    if (this.peerSession.userB?.connectionId === myId) return this.peerSession.userA?.connectionId ?? null;
    return null;
  }
}