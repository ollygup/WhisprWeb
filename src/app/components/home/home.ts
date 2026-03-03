import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Layout } from '../layout/layout';
import { TransferPane } from '../transfer-pane/transfer-pane';
import { UserPane } from '../user-pane/user-pane';

@Component({
  selector: 'app-home',
  imports: [Layout, TransferPane, UserPane],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private route  = inject(ActivatedRoute);

  public joinGroupId = signal<string | null>(null);

  protected readonly title = signal('WhisprWeb');

  async ngOnInit() {
    const url = new URL(window.location.href);
    const groupId = url.searchParams.get('join');

    if (groupId) {
      this.joinGroupId.set(groupId);

      // Remove the join param from the URL without reloading
      url.searchParams.delete('join');
      window.history.replaceState({}, '', url.toString());
    }
    console.log('groupId:', groupId);
  }
}

