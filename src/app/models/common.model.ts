export type TransferStatus = 'idle' | 'connected' | 'active' | 'done' | 'error' | 'cancelled' | 'self-cancelled';
export const transferStatusLabel: Record<TransferStatus, string> = {
    idle: 'Idle',
    connected: 'Ready',
    active: 'In progress',
    done: 'Complete',
    error: 'Error',
    cancelled: 'Cancelled',
    "self-cancelled": 'Self-Cancelled'
};

export type CancelReason = 'user-cancelled' | 'transfer-failed';

export type UserInfo = {
    connectionId: string;
    userCode: string;
}

export type PeerSession = {
    userA: UserInfo | null;
    userB: UserInfo | null;
    isFull: boolean;
}

export interface FileOfferDto {
    type: 'file-offer';
    name: string;
    size: number;
    mimeType: string;
    totalChunks: number;
}