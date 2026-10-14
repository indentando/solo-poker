import { Component, computed, input } from '@angular/core';
import { presetOf } from './avatar-presets';

/** Dibuja el icono de un jugador. Toma el tamaño del `font-size` del contenedor. */
@Component({
  selector: 'app-avatar',
  template: `
    @if (preset(); as preset) {
      <svg viewBox="0 0 24 24" width="0.8em" height="0.8em" aria-hidden="true"
           [attr.fill]="preset.color" [attr.fill-rule]="preset.evenOdd ? 'evenodd' : null">
        @for (d of paths(); track $index) {
          <path [attr.d]="d" />
        }
      </svg>
    } @else {
      <span aria-hidden="true">{{ emoji() }}</span>
    }
  `,
  host: {
    class: 'inline-flex items-center justify-center leading-none',
    role: 'img',
    '[attr.aria-label]': 'label()',
  },
})
export class Avatar {
  /** "e:🦊" o "p:spade". */
  readonly value = input.required<string>();

  protected readonly preset = computed(() => presetOf(this.value()));
  /** Con evenodd, los agujeros solo se recortan si todas las formas van en un único trazado. */
  protected readonly paths = computed(() => {
    const preset = this.preset();
    if (!preset) return [];
    return preset.evenOdd ? [preset.paths.join(' ')] : preset.paths;
  });
  protected readonly emoji = computed(() => (this.value().startsWith('e:') ? this.value().slice(2) : ''));
  protected readonly label = computed(() => this.preset()?.label ?? this.emoji());
}
