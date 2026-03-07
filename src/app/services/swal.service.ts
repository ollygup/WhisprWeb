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
