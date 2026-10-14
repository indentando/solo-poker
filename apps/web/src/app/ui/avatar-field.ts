import { Component, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { emojiAvatar, isSingleEmoji } from '@solo-poker/protocol';
import { Avatar } from './avatar';
import { EMOJI_AVATARS, PRESET_AVATARS } from './avatar-presets';

/**
 * Botón con tu icono actual. Al pulsarlo abre un panel para elegir entre los
 * predeterminados, una selección de emojis o cualquier otro emoji.
 * Los iconos que ya llevan otros jugadores de la mesa salen desactivados.
 */
@Component({
  selector: 'app-avatar-field',
  imports: [FormsModule, Avatar],
  template: `
    <button type="button" class="trigger" aria-label="Cambiar icono" (click)="open.set(true)">
      <app-avatar [value]="value()" />
      <span class="edit" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
             stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
      </span>
    </button>

    @if (open()) {
      <div class="sheet-backdrop" (click)="open.set(false)">
        <div class="sheet max-h-[85dvh] overflow-y-auto" animate.enter="sheet-enter" (click)="$event.stopPropagation()">
          <div class="mb-5 flex items-center justify-between">
            <h2 class="text-xl font-light">Elige tu icono</h2>
            <button type="button" class="btn btn-sm px-4" (click)="open.set(false)">Listo</button>
          </div>

          <span class="label">Iconos</span>
          <div class="grid grid-cols-6 gap-2">
            @for (avatar of presets; track avatar) {
              <button type="button" class="option text-[1.75rem]" [class.selected]="avatar === value()"
                      [disabled]="isTaken(avatar)" (click)="choose(avatar)">
                <app-avatar [value]="avatar" />
              </button>
            }
          </div>

          <span class="label mt-6">Emojis</span>
          <div class="grid grid-cols-8 gap-1.5">
            @for (avatar of emojis; track avatar) {
              <button type="button" class="option text-2xl" [class.selected]="avatar === value()"
                      [disabled]="isTaken(avatar)" (click)="choose(avatar)">
                <app-avatar [value]="avatar" />
              </button>
            }
          </div>

          <form class="mt-6 flex gap-2" (ngSubmit)="useCustom()">
            <input class="field h-12 flex-1 text-center text-2xl placeholder:text-base" name="custom"
                   [(ngModel)]="custom" maxlength="16" autocomplete="off" placeholder="¿Otro emoji?"
                   aria-label="Otro emoji" />
            <button type="submit" class="btn btn-sm h-12 px-5" [disabled]="!custom().trim()">Usar</button>
          </form>
          @if (customError(); as message) {
            <p class="mt-2 text-sm text-suit-red">{{ message }}</p>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .trigger {
      position: relative;
      display: flex;
      height: 3.5rem;
      width: 3.5rem;
      flex: none;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: var(--color-surface);
      font-size: 2rem;
    }
    .edit {
      position: absolute;
      right: -2px;
      bottom: -2px;
      display: flex;
      height: 1.25rem;
      width: 1.25rem;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      border: 2px solid #000;
      background: #fff;
      color: #000;
    }
    .option {
      display: flex;
      aspect-ratio: 1;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      transition: background-color 120ms;
    }
    .option:hover:not(:disabled) {
      background: rgb(255 255 255 / 0.08);
    }
    .option.selected {
      background: rgb(255 255 255 / 0.12);
      box-shadow: inset 0 0 0 1.5px #fff;
    }
    .option:disabled {
      opacity: 0.2;
    }
  `,
})
export class AvatarField {
  readonly value = model.required<string>();
  /** Iconos que ya llevan otros jugadores de la mesa. */
  readonly taken = input<readonly string[]>([]);

  protected readonly presets = PRESET_AVATARS;
  protected readonly emojis = EMOJI_AVATARS;
  protected readonly open = signal(false);
  protected readonly custom = signal('');
  protected readonly customError = signal<string | null>(null);

  protected isTaken(avatar: string): boolean {
    return avatar !== this.value() && this.taken().includes(avatar);
  }

  protected choose(avatar: string): void {
    this.value.set(avatar);
    this.open.set(false);
  }

  protected useCustom(): void {
    const emoji = this.custom().trim();
    if (!isSingleEmoji(emoji)) {
      this.customError.set('Escribe un único emoji.');
      return;
    }
    const avatar = emojiAvatar(emoji);
    if (this.isTaken(avatar)) {
      this.customError.set('Ese emoji ya lo lleva otro jugador.');
      return;
    }
    this.customError.set(null);
    this.custom.set('');
    this.choose(avatar);
  }
}
