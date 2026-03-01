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

}
