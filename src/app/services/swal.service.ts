import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';


@Injectable({
    providedIn: 'root'
})
export class SwalService {
    showUserDisconnectedPopup() {
        return Swal.fire({
            theme: 'dark',
            icon: 'warning',
            title: 'User disconnected',
            text: 'The other user has left the call.',
            confirmButtonText: 'OK',
            allowOutsideClick: false,
            allowEscapeKey: false
        });
    }

    showError(message: string) {
        return Swal.fire({
            theme: 'dark',
            icon: 'warning',
            title: 'Error',
            text: message,
            confirmButtonText: 'OK',
            allowOutsideClick: false,
            allowEscapeKey: false
        });
    }

    showCornerPopupMsg(message: string) {
        return Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: message,
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            theme: 'dark'
        });
    }

    showFileOfferPrompt(fileName: string, fileSize: string) {
        return Swal.fire({
            theme: 'dark',
            title: 'Incoming File',
            html: `
                <div style="text-align: left; display: flex; flex-direction: column; gap: 8px;">
                    <div><strong>File:</strong> ${fileName}</div>
                    <div><strong>Size:</strong> ${fileSize}</div>
                    <div style="margin-top: 8px; opacity: 0.7; font-size: 0.85em;">
                        The file will be saved to your browser's default Downloads folder.
                    </div>
                    <div style="
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-top: 8px;
                        padding: 10px 12px;
                        border-radius: 8px;
                        background: color-mix(in srgb, #00d4ff 8%, transparent);
                        border: 1px solid color-mix(in srgb, #00d4ff 20%, transparent);
                        color: #00d4ff;
                        font-size: 0.78em;
                    ">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        Third-party download managers are not supported. Disable yours before accepting.
                    </div>
                </div>
                `,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Accept',
            cancelButtonText: 'Decline',
            allowOutsideClick: false,
            allowEscapeKey: false
        });
    }

    closeAll(): void {
        Swal.close();
    }
}
