import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LIMITS, type TableInfo } from '@solo-poker/protocol';
import { MoneyPipe, errorMessage } from '../../core/format';
import { loadProfile, saveProfile } from '../../core/storage';
import { TableService } from '../../core/table.service';
import { AvatarField } from '../../ui/avatar-field';
import { pickAvatar } from '../../ui/avatar-presets';

/** Lee la clave del fragmento del enlace (#k=…) y la borra de la barra de direcciones. */
function takePasswordFromUrl(): string {
  const match = /[#&]k=([^&]+)/.exec(window.location.hash);
  if (!match) return '';
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-join-form',
  imports: [FormsModule, MoneyPipe, AvatarField],
  template: `
    <div class="mb-8">
      <p class="text-sm text-muted">Mesa</p>
      <h1 class="text-4xl font-extralight tracking-[0.15em]">{{ info().tableId }}</h1>
      <p class="mt-2 text-muted">
        {{ info().players }}/{{ info().maxPlayers }} jugadores · Entrada {{ info().buyIn | money }}
      </p>
    </div>

    @if (closedReason(); as reason) {
      <p class="rounded-2xl bg-surface p-5 text-center text-white/80">{{ reason }}</p>
    } @else {
      <form class="flex flex-1 flex-col gap-6 pb-10" (ngSubmit)="submit()">
        <div>
          <label class="label" for="nickname">Tú</label>
          <div class="flex items-center gap-3">
            <app-avatar-field [(value)]="avatar" [taken]="info().takenAvatars" />
            <input class="field" id="nickname" name="nickname" [(ngModel)]="nickname" [maxlength]="limits.maxNickname"
                   autocomplete="nickname" placeholder="Cómo te verán en la mesa" />
          </div>
        </div>
        <label>
          <span class="label">Clave de la mesa</span>
          <input class="field" name="password" [(ngModel)]="password" [maxlength]="limits.maxPassword"
                 autocomplete="off" spellcheck="false" placeholder="Te la ha pasado quien creó la mesa" />
        </label>

        <div class="mt-auto flex flex-col gap-3">
          @if (error(); as message) {
            <p class="text-center text-sm text-suit-red">{{ message }}</p>
          }
          <button class="btn btn-primary" type="submit" [disabled]="!valid() || pending()">
            {{ pending() ? 'Sentándote…' : 'Sentarse' }}
          </button>
        </div>
      </form>
    }
  `,
  host: { class: 'flex flex-1 flex-col' },
})
export class JoinForm {
  private readonly table = inject(TableService);

  readonly info = input.required<TableInfo>();
  readonly joined = output<void>();

  private readonly profile = loadProfile();

  protected readonly limits = LIMITS;
  protected readonly nickname = signal(this.profile?.nickname ?? '');
  /** Tu último icono si nadie de la mesa lo lleva; si no, uno libre al azar. */
  protected readonly avatar = linkedSignal(() => pickAvatar(this.profile?.avatar, this.info().takenAvatars));
  protected readonly password = signal(takePasswordFromUrl());
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly valid = computed(
    () => this.nickname().trim().length > 0 && this.password().length >= LIMITS.minPassword,
  );
  protected readonly closedReason = computed(() => {
    const info = this.info();
    if (info.status === 'finished') return 'Esta partida ya ha terminado.';
    if (info.status === 'playing') return 'La partida ya ha empezado: no se puede entrar.';
    if (info.players >= info.maxPlayers) return 'La mesa está llena.';
    return null;
  });

  protected async submit(): Promise<void> {
    if (!this.valid() || this.pending()) return;
    this.pending.set(true);
    this.error.set(null);

    const profile = { nickname: this.nickname().trim(), avatar: this.avatar() };
    const result = await this.table.join({
      ...profile,
      tableId: this.info().tableId,
      password: this.password(),
    });

    this.pending.set(false);
    if (result.ok) {
      saveProfile(profile);
      this.joined.emit();
    } else {
      this.error.set(errorMessage(result.error));
    }
  }
}
