import { Component, signal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { WebrtcService } from '../../services/webrtc.service';
import { FileOfferDto, PeerSession, TransferStatus } from '../../models/common.model';
import { SignalRService } from '../../services/signalr.service';

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
  private receiverDirHandle: FileSystemDirectoryHandle | null = null;
  private receivedChunks: ArrayBuffer[] = [];
  private expectedChunks = 0;

  // ── Peer connected gate ───────────────────────────────────
  peerConnected = signal(false);

  // ── Sender state ──────────────────────────────────────────
  sendStatus   = signal<TransferStatus>('idle');
  sendProgress = signal(0);
  fileName     = signal<string | null>(null);
  fileSize     = signal<string | null>(null);
  isDragging   = signal(false);
  peerReady    = signal(false);
  peerRejected = signal(false);

  // ── Receiver state ────────────────────────────────────────
  incomingFileOffer = signal<FileOfferDto | null>(null);
  receiveStatus     = signal<TransferStatus>('idle');
  receiveProgress   = signal(0);
  saveDirSelected   = signal(false);

  constructor(
    private webrtcService: WebrtcService,
    private signalRService: SignalRService
  ) {
    // Track peer session
    effect(() => {
      this.peerSession = this.signalRService.peerSession();
      this.peerConnected.set(this.peerSession?.isFull ?? false);

      // Peer left — reset everything
      if (!this.peerSession) {
        this.resetSend();
        this.resetReceive();
      }
    });

    // Incoming file offer from peer (via SignalR)
    effect(() => {
      const offer = this.signalRService.fileOffer();
      if (!offer) return;
      this.incomingFileOffer.set(offer);
      this.expectedChunks = offer.totalChunks;
      this.receivedChunks = [];
      this.receiveStatus.set('connected');
      this.saveDirSelected.set(false);
    });

    // Peer responded to our file offer
    effect(() => {
      const response = this.signalRService.fileOfferResponse();
      if (response === null) return; // no response yet

      if (response === true) {
        this.peerReady.set(true);
        this.peerRejected.set(false);
      } else {
        // Peer rejected — reset send state
        this.peerRejected.set(true);
        this.peerReady.set(false);
        this.sendStatus.set('idle');
        this.fileName.set(null);
        this.fileSize.set(null);
        this.selectedFile = null;
      }
    });
  }

  ngOnInit() {
    // Data channel — only raw file chunks come through here
    this.sub.add(
      this.webrtcService.data$.subscribe(data => this.handleIncoming(data))
    );

    // Peer disconnected mid-transfer
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

  // ── Incoming data (data channel only — raw chunks + transfer-complete) ──
  private handleIncoming(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data) as DataMessage;
        if (msg.type === 'transfer-complete') this.assembleAndSave();
      } catch { console.error('[Transfer] Failed to parse message'); }
      return;
    }

    // Binary chunk
    if (this.receiveStatus() === 'active') {
      this.receivedChunks.push(data);
      const progress = Math.round((this.receivedChunks.length / this.expectedChunks) * 100);
      this.receiveProgress.set(progress);
    }
  }

  // ── Sender: file pick ─────────────────────────────────────
  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.setFile(file);
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave()            { this.isDragging.set(false); }

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
    this.sendStatus.set('connected');

    // Coordinate via SignalR — peer needs to pick save directory first
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const offer: FileOfferDto = {
      type: 'file-offer',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks
    };

    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOffer(targetId, offer);
  }

  // ── Sender: send chunks via data channel ──────────────────
  async startSend(): Promise<void> {
    if (!this.selectedFile || !this.peerReady()) return;

    this.sendStatus.set('active');
    this.sendProgress.set(0);
    this.peerRejected.set(false);

    const file        = this.selectedFile;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end   = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();

      this.webrtcService.sendBuffer(chunk);
      this.sendProgress.set(Math.round(((i + 1) / totalChunks) * 100));

      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }

    // Only transfer-complete goes through data channel — it's tiny and timing-critical
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

  // ── Receiver: pick save directory (response via SignalR) ──
  async pickSaveDirectory(): Promise<void> {
    try {
      this.receiverDirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      this.saveDirSelected.set(true);
      this.receiveStatus.set('active');

      // Notify sender via SignalR — they can now start sending
      const targetId = this.getRemoteConnectionId();
      if (targetId) this.signalRService.sendFileOfferResponse(targetId, true);
    } catch (err) {
      console.error('[Transfer] Directory picker cancelled or failed', err);
    }
  }

  dismissOffer() {
    const targetId = this.getRemoteConnectionId();
    if (targetId) this.signalRService.sendFileOfferResponse(targetId, false);

    this.incomingFileOffer.set(null);
    this.receiveStatus.set('idle');
    this.saveDirSelected.set(false);
  }

  // ── Receiver: assemble + save ─────────────────────────────
  private async assembleAndSave(): Promise<void> {
    const offer = this.incomingFileOffer();
    if (!offer || !this.receiverDirHandle) return;

    try {
      const blob       = new Blob(this.receivedChunks, { type: offer.mimeType });
      const fileHandle = await this.receiverDirHandle.getFileHandle(offer.name, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      this.receiveStatus.set('done');
      this.receiveProgress.set(100);
    } catch (err) {
      this.receiveStatus.set('error');
      console.error('[Transfer] Failed to save file', err);
    }
  }

  resetReceive() {
    this.incomingFileOffer.set(null);
    this.receiveStatus.set('idle');
    this.receiveProgress.set(0);
    this.saveDirSelected.set(false);
    this.receivedChunks = [];
    this.receiverDirHandle = null;
  }

  // ── Helpers ───────────────────────────────────────────────
  statusLabel(s: TransferStatus): string {
    return { idle: 'Idle', connected: 'Ready', active: 'In progress', done: 'Complete', error: 'Error' }[s] ?? s;
  }

  formatBytes(b: number): string {
    if (b < 1024)      return `${b} B`;
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