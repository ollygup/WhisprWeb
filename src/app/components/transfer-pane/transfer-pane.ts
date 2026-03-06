import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, effect, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FileOfferDto, PeerSession, TransferStatus } from '../../models/common.model';
import { SignalRService } from '../../services/signalr.service';
import { SwalService } from '../../services/swal.service';
import { WebrtcService } from '../../services/webrtc.service';

type DataMessage = { type: 'transfer-complete' };

const CHUNK_SIZE = 64 * 1024; // 64KB

@Component({
  selector: 'app-transfer-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transfer-pane.html',
  styleUrl: './transfer-pane.scss'
})
export class TransferPane implements OnInit, OnDestroy {

  private peerSession: PeerSession | null = null;
  private sub = new Subscription();
  private selectedFile: File | null = null;

  // ── Stream bridge state ───────────────────────────────────
  private downloadId: string | null = null;
  private bytesReceived = 0;

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

  // ── Receiver state ────────────────────────────────────────
  incomingFileOffer = signal<FileOfferDto | null>(null);
  receiveStatus = signal<TransferStatus>('idle');
  receiveProgress = signal(0);

  constructor(
    private webrtcService: WebrtcService,
    private signalRService: SignalRService,
    private swalService: SwalService
  ) {
    // Track peer session
    effect(() => {
      this.peerSession = this.signalRService.peerSession();
      this.peerConnected.set(this.peerSession?.isFull ?? false);

      if (!this.peerSession) {
        this.resetSend();
        this.resetReceive();
      }
    });

    // Incoming file offer from peer — show Swal prompt immediately
    effect(() => {
      const offer = this.signalRService.fileOffer();
      if (!offer) return;
      this.incomingFileOffer.set(offer);
      this.bytesReceived = 0;
      this.receiveStatus.set('connected');
      this.promptFileOffer(offer);
    });

    // Peer responded to our file offer — auto-trigger send if accepted
    effect(() => {
      const response = this.signalRService.fileOfferResponse();
      if (response === null) return;

      if (response === true) {
        this.peerReady.set(true);
        this.peerRejected.set(false);
        this.startSend(); // auto-trigger — no manual Send click needed
      } else {
        this.peerRejected.set(true);
        this.peerReady.set(false);
        this.sendStatus.set('idle');
        // keep fileName/fileSize visible so sender can try again
      }
    });
  }

  ngOnInit() {
    this.sub.add(
      this.webrtcService.data$.subscribe(data => this.handleIncoming(data))
    );

    this.sub.add(
      this.signalRService.onPeerDisconnected$.subscribe(() => {
        this.resetSend();
        this.resetReceive();
        this.peerConnected.set(false);
      })
    );
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  // ── Receiver: Swal prompt ─────────────────────────────────
  private async promptFileOffer(offer: FileOfferDto): Promise<void> {
    const result = await this.swalService.showFileOfferPrompt(
      offer.name,
      this.formatBytes(offer.size)
    );

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

  // ── Incoming data — pipe chunks straight to SW ────────────
  private handleIncoming(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data) as DataMessage;
        if (msg.type === 'transfer-complete') this.finaliseDownload();
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

  // ── Sender: file pick — store only, no offer sent yet ─────
  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.setFile(file);
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
    this.sendStatus.set('idle'); // stay idle — offer not sent until user clicks Send
  }

  // ── Sender: send offer — triggered by Send File button ────
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

    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOffer(targetId, offer);

    this.sendStatus.set('connected'); // offer sent — waiting for peer response
  }

  // ── Sender: send chunks — auto-called when peer accepts ───
  async startSend(): Promise<void> {
    if (!this.selectedFile) return;

    this.sendStatus.set('active');
    this.sendProgress.set(0);

    const file = this.selectedFile;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      await this.webrtcService.waitForBufferDrain(); // event-driven, not polling

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();

      this.webrtcService.sendBuffer(chunk);
      this.sendProgress.set(Math.round(((i + 1) / totalChunks) * 100));
    }

    // Wait for final chunks to drain before signalling complete
    await this.webrtcService.waitForBufferDrain();
    this.webrtcService.sendMessage(JSON.stringify({ type: 'transfer-complete' }));
    this.sendStatus.set('done');
  }

  resetSend() {
    this.sendStatus.set('idle');
    this.sendProgress.set(0);
    this.fileName.set(null);
    this.fileSize.set(null);
    this.selectedFile = null;
    this.peerReady.set(false);
    this.peerRejected.set(false);
  }

  resetReceive() {
    this.incomingFileOffer.set(null);
    this.receiveStatus.set('idle');
    this.receiveProgress.set(0);
    this.downloadId = null;
    this.bytesReceived = 0;
  }

  // ── Helpers ───────────────────────────────────────────────
  statusLabel(s: TransferStatus): string {
    return { idle: 'Idle', connected: 'Ready', active: 'In progress', done: 'Complete', error: 'Error' }[s] ?? s;
  }

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