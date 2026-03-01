import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TransferStatus = 'idle' | 'connected' | 'active' | 'done' | 'error';

@Component({
  selector: 'app-transfer-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transfer-pane.html',
  styleUrl: './transfer-pane.scss'
})
export class TransferPane {

  // ── Sender state ─────────────────────────────────────────
  sendStatus   = signal<TransferStatus>('idle');
  sendProgress = signal(0);
  fileName     = signal<string | null>(null);
  fileSize     = signal<string | null>(null);
  isDragging   = signal(false);

  // ── Receiver state ───────────────────────────────────────
  recvStatus    = signal<TransferStatus>('idle');
  recvProgress  = signal(0);
  saveDirectory = signal<string | null>(null);

  // ── Sender: file pick ────────────────────────────────────
  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.fileSize.set(this.formatBytes(file.size));
    this.sendStatus.set('connected');
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave()            { this.isDragging.set(false); }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.fileSize.set(this.formatBytes(file.size));
    this.sendStatus.set('connected');
  }

  startSend() {
    this.sendStatus.set('active');
    this.sendProgress.set(0);
    const t = setInterval(() => {
      this.sendProgress.update(p => {
        if (p >= 100) { clearInterval(t); this.sendStatus.set('done'); return 100; }
        return p + 2;
      });
    }, 60);
  }

  resetSend() {
    this.sendStatus.set('idle');
    this.sendProgress.set(0);
    this.fileName.set(null);
    this.fileSize.set(null);
  }

  // ── Receiver: directory pick ─────────────────────────────
  async onDirectorySelect() {
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker();
      this.saveDirectory.set(handle.name);
      this.recvStatus.set('connected');
    } catch { /* cancelled */ }
  }

  startReceive() {
    this.recvStatus.set('active');
    this.recvProgress.set(0);
    const t = setInterval(() => {
      this.recvProgress.update(p => {
        if (p >= 100) { clearInterval(t); this.recvStatus.set('done'); return 100; }
        return p + 2;
      });
    }, 60);
  }

  resetRecv() {
    this.recvStatus.set('idle');
    this.recvProgress.set(0);
    this.saveDirectory.set(null);
  }

  // ── Helpers ──────────────────────────────────────────────
  statusLabel(s: TransferStatus): string {
    return { idle: 'Idle', connected: 'Ready', active: 'In progress', done: 'Complete', error: 'Error' }[s];
  }

  private formatBytes(b: number): string {
    if (b < 1024)      return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }
}