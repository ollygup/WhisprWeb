export type TransferStatus = 'idle' | 'connected' | 'active' | 'done' | 'error';


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