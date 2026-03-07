import { Component, signal } from '@angular/core';
import { TransferStatus } from '../../models/common.model';
import { CommonModule } from '@angular/common';
import { transferStatusLabel } from '../../models/common.model';

@Component({
  selector: 'app-receive-pane',
  imports: [CommonModule],
  templateUrl: './receive-pane.html',
  styleUrl: './receive-pane.scss',
})
export class ReceivePane {
  protected readonly statusLabel = transferStatusLabel;

  // ── Receiver state ───────────────────────────────────────
  recvStatus    = signal<TransferStatus>('idle');
  recvProgress  = signal(0);
  saveDirectory = signal<string | null>(null);

  
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
}
