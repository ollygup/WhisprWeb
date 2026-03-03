import { Component, signal, computed, OnInit, OnDestroy, effect, input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SignalRService } from '../../services/signalr.service';
import { WebrtcService } from '../../services/webrtc.service';
import { UserInfo } from '../../models/common.model';
import { SwalService } from '../../services/swal.service';
import { QRService } from '../../services/qr.service';
import { NgxQrcodeStylingComponent } from 'ngx-qrcode-styling';

export interface SideStats {
  latency: number;
  packetLoss: number;
  bandwidth: number;
}

export interface Quality {
  label: string;
  color: string;
  bg: string;
}

const MAX_HISTORY = 20;

@Component({
  selector: 'app-user-pane',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxQrcodeStylingComponent],
  templateUrl: './user-pane.html',
  styleUrl: './user-pane.scss'
})
export class UserPane implements OnInit, OnDestroy {
  // if join from QR
  pendingGroupId = input<string | null>(null);

  private sub = new Subscription();
  private statsTimer?: ReturnType<typeof setInterval>;

  // ── Local user ────────────────────────────────────────────
  userCode = signal<string | null>(null);
  copied = signal(false);
  showQR = signal(false);

  // ── Peer ─────────────────────────────────────────────────
  peerInput = signal('');
  peerUserCode = signal<string | null>(null);
  rtcConnected = signal(false);

  // ── Connection state ──────────────────────────────────────
  connected = signal(false);
  connecting = signal(false);
  error = signal<string | null>(null);

  // ── Stats (local only) ────────────────────────────────────
  localStats = signal<SideStats | null>(null);
  localLatHistory = signal<number[]>([]);
  localLossHistory = signal<number[]>([]);

  // ── QR ────────────────────────────────────────────────────
  peerCode = computed(() => this.peerUserCode());

  @ViewChild('qrCode') qrCode!: NgxQrcodeStylingComponent;

  constructor(
    private signalRService: SignalRService,
    private webrtcService: WebrtcService,
    private swalService: SwalService,
    protected qrService: QRService
  ) {
    // When peerSession is full extract the remote peer's userCode
    effect(() => {
      const session = this.signalRService.peerSession();

      if (session?.isFull) {
        const myId = this.signalRService.getMyConnectionId();
        const remotePeer: UserInfo | null =
          session.userA?.connectionId === myId ? session.userB :
            session.userB?.connectionId === myId ? session.userA :
              null;
        if (remotePeer) this.peerUserCode.set(remotePeer.userCode);
      }

      // Session cleared by server (peer left or disconnected)
      if (!session) {
        this.peerUserCode.set(null);
        this.peerInput.set('');
      }
    });

    effect(() => {
      const groupId = this.pendingGroupId();
      const peerInput = this.peerInput();
      if (peerInput == '' && groupId != null) {
        this.peerInput.set(groupId); // tracked automatically
        this.connect();
      } else if (peerInput != '' && groupId != null) {
        this.swalService.showError("You are already in a group, leave to join a new one");
      }
    });

    effect(() => {
      const isConnected = this.connected();
      const groupId = this.pendingGroupId();
      if (isConnected && groupId !== null) {
        this.peerInput.set(groupId);
        this.connectToPeer();
      }
    })

  }

  ngOnInit() {
    this.sub.add(
      this.signalRService.onReceiveCode$.subscribe(code => {
        this.userCode.set(code);
        this.connected.set(true);
        this.connecting.set(false);
        this.qrService.updateData(code);
      })
    );

    // Peer explicitly disconnected — notify user
    this.sub.add(
      this.signalRService.onPeerDisconnected$.subscribe(() => {
        this.peerUserCode.set(null);
        this.peerInput.set('');
        this.error.set('Peer disconnected from the session.');
        setTimeout(() => this.error.set(null), 4000);
      })
    );

    this.sub.add(
      this.webrtcService.connectionState$.subscribe(state => {
        this.rtcConnected.set(state === 'connected');

        if (state === 'connected') {
          this.startStatsPolling();
        }

        if (state === 'disconnected' || state === 'idle') {
          this.stopStatsPolling();
          this.localStats.set(null);
          this.localLatHistory.set([]);
          this.localLossHistory.set([]);
        }
      })
    );

    this.connect();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.stopStatsPolling();
  }

  // ── Connect ───────────────────────────────────────────────
  connect() {
    this.connecting.set(true);
    this.error.set(null);
    this.sub.add(
      this.signalRService.connectAndRegister().subscribe({
        next: () => { },
        error: (err) => {
          this.connecting.set(false);
          this.error.set('Connection failed. Try again.');
          console.error(err);
        }
      })
    );
  }

  disconnect() {
    this.connected.set(false);
    this.connecting.set(false);
    this.userCode.set(null);
    this.peerUserCode.set(null);
    this.peerInput.set('');
    this.error.set(null);
    this.localStats.set(null);
    this.localLatHistory.set([]);
    this.localLossHistory.set([]);
    this.rtcConnected.set(false);
    this.stopStatsPolling();
  }

  // ── Code ─────────────────────────────────────────────────
  copyCode() {
    const code = this.userCode();
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    });
  }

  openQR() { this.showQR.set(true); }
  closeQR() { this.showQR.set(false); }

  // ── Peer ─────────────────────────────────────────────────
  connectToPeer() {
    const val = this.peerInput().trim().toUpperCase();
    if (!val) return;
    this.signalRService.joinUserGroup(val);
  }

  // Notifies peer via SignalR then clears local state
  clearPeer() {
    this.signalRService.leaveGroup();
    this.peerUserCode.set(null);
    this.peerInput.set('');
  }

  onPeerInput(val: string) { this.peerInput.set(val.toUpperCase()); }

  // ── Status ────────────────────────────────────────────────
  statusLabel(): string {
    if (this.connecting()) return 'Connecting…';
    if (this.rtcConnected()) return 'P2P Active';
    if (this.connected()) return 'Online';
    return 'Offline';
  }

  statusColor(): string {
    if (this.connecting()) return 'var(--status-warn)';
    if (this.rtcConnected()) return 'var(--accent)';
    if (this.connected()) return 'var(--status-ok)';
    return 'var(--text-tertiary)';
  }

  // ── Quality badge ─────────────────────────────────────────
  getQuality(stats: SideStats | null): Quality | null {
    if (!stats) return null;
    if (stats.latency < 50 && stats.packetLoss < 0.5)
      return { label: 'EXCELLENT', color: 'var(--status-ok)', bg: 'color-mix(in srgb, var(--status-ok) 12%, transparent)' };
    if (stats.latency < 100 && stats.packetLoss < 2)
      return { label: 'GOOD', color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 12%, transparent)' };
    if (stats.latency < 150 && stats.packetLoss < 5)
      return { label: 'FAIR', color: 'var(--status-warn)', bg: 'color-mix(in srgb, var(--status-warn) 12%, transparent)' };
    return { label: 'POOR', color: 'var(--status-err)', bg: 'color-mix(in srgb, var(--status-err) 12%, transparent)' };
  }

  getLatencyColor(ms: number): string {
    if (ms < 50) return 'var(--status-ok)';
    if (ms < 100) return 'var(--accent)';
    if (ms < 150) return 'var(--status-warn)';
    return 'var(--status-err)';
  }

  getLossColor(pct: number): string {
    if (pct < 0.5) return 'var(--status-ok)';
    if (pct < 2) return 'var(--accent)';
    if (pct < 5) return 'var(--status-warn)';
    return 'var(--status-err)';
  }

  getBottleneck(): { label: string; color: string } | null {
    const l = this.localStats();
    if (!l) return null;
    if (l.packetLoss > 2 || l.latency > 150)
      return { label: 'Your network', color: 'var(--status-err)' };
    if (l.latency > 80)
      return { label: "Peer's network", color: 'var(--status-warn)' };
    if (l.bandwidth > 900)
      return { label: 'Disk I/O', color: 'var(--status-warn)' };
    return null;
  }

  // ── Sparklines ────────────────────────────────────────────
  buildSparkPoints(history: number[]): string {
    if (history.length < 2) return '';
    const max = Math.max(...history, 1);
    const step = 100 / (history.length - 1);
    return history.map((v, i) => `${i * step},${100 - (v / max) * 90}`).join(' ');
  }

  buildSparkArea(history: number[]): string {
    if (history.length < 2) return '';
    return `0,100 ${this.buildSparkPoints(history)} 100,100`;
  }

  // ── Stats polling ─────────────────────────────────────────
  private startStatsPolling() {
    this.stopStatsPolling();
    this.statsTimer = setInterval(() => this.pollStats(), 1000);
  }

  private stopStatsPolling() {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = undefined; }
  }

  private async pollStats() {
    const report = await this.webrtcService.getStats();
    if (!report) return;

    let bytesSent = 0, bytesReceived = 0, rtt = 0, hasData = false;
    let packetsLost = 0, packetsSent = 0;

    report.forEach((r: RTCStats) => {
      const s = r as any;
      if (s.type === 'candidate-pair' && s.nominated) {
        rtt = s.currentRoundTripTime ?? 0;
        bytesSent = s.bytesSent ?? 0;
        bytesReceived = s.bytesReceived ?? 0;
        hasData = true;
      }
      if (s.type === 'outbound-rtp') packetsSent = s.packetsSent ?? 0;
      if (s.type === 'inbound-rtp') packetsLost = s.packetsLost ?? 0;
    });

    if (!hasData) return;

    const latencyMs = Math.round(rtt * 1000);
    const lossRaw = packetsSent > 0 ? (packetsLost / packetsSent) * 100 : 0;
    const bandwidthMbps = ((bytesSent + bytesReceived) * 8) / 1_000_000;

    this.localStats.set({
      latency: latencyMs,
      packetLoss: parseFloat(lossRaw.toFixed(1)),
      bandwidth: parseFloat(bandwidthMbps.toFixed(1))
    });

    this.localLatHistory.update(h => [...h.slice(-MAX_HISTORY + 1), latencyMs]);
    this.localLossHistory.update(h => [...h.slice(-MAX_HISTORY + 1), lossRaw]);
  }

  // QR
  downloadQR() { this.qrService.download(this.qrCode); }
  shareQR() { this.qrService.share(this.qrCode); }
} 