import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Layout } from './components/layout/layout';
import { TransferPane } from './components/transfer-pane/transfer-pane';
import { UserPane } from './components/user-pane/user-pane';

@Component({
  selector: 'app-root',
  imports: [Layout, TransferPane, UserPane],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App{
  private route  = inject(ActivatedRoute);

  public joinGroupId = signal<string | null>(null);

  protected readonly title = signal('WhisprWeb');

  async ngOnInit() {
    const groupId = this.route.snapshot.queryParams['join'];
    if (groupId) this.joinGroupId.set(groupId);

  
    console.log('groupId:', groupId);
  }
}
