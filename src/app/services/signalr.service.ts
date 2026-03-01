import { Injectable, signal } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../environments/environment";
import { HubConnection, HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";

@Injectable({
  providedIn: 'root'
})
export class SignalRService {
  private connection: HubConnection | null = null;
  private hubUrl = environment.hubUrl;
  private connectionState = signal<HubConnectionState>(HubConnectionState.Disconnected);


  connectAndRegister(username: string): Observable<void> {
    return new Observable<void>(observer => {
      this.connection = new HubConnectionBuilder()
        .withUrl(this.hubUrl, { withCredentials: true })
        .withAutomaticReconnect()
        .build();

      this.setupMessageHandlers();

      this.connection.start()
        .then(() => {
          console.log('Connected to SignalR!');
          this.connectionState.set(this.connection!.state);
          return this.connection!.invoke('Register', username);
        })
        .then(() => {
          console.log('Registered successfully!');
          observer.next();
          observer.complete();
        })
        .catch(error => {
          console.error('Connection/Registration failed:', error);
          this.connectionState.set(HubConnectionState.Disconnected);
          observer.error(error);
        });
    });
  }

  private setupMessageHandlers(): void {
    if (!this.connection) return;

    console.log('Setting up SignalR message handlers...');

    this.connection.on('Error', (errorMsg: string) => {
      console.log('Error:', errorMsg);
    });
  }
}