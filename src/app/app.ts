import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Layout } from './components/layout/layout';
import { TransferPane } from './components/transfer-pane/transfer-pane';
import { ReceivePane } from './components/receive-pane/receive-pane';
import { UserPane } from './components/user-pane/user-pane';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Layout, TransferPane, ReceivePane, UserPane],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('WhisprWeb');
}
