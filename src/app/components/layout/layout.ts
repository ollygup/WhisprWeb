import { Component, signal, effect, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './layout.html',
  styleUrl: './layout.scss'
})
export class Layout {
  isDark = signal(true);

  constructor(private renderer: Renderer2) {
    effect(() => {
      const theme = this.isDark() ? 'dark' : 'light';
      this.renderer.setAttribute(document.documentElement, 'data-theme', theme);
    });
  }

  toggleTheme() {
    this.isDark.update(v => !v);
  }
}