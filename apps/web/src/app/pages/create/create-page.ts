import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { standardBlindStructure } from '@solo-poker/engine';
import { LIMITS } from '@solo-poker/protocol';
import { MoneyPipe, errorMessage } from '../../core/format';
import { loadProfile, rememberPassword, saveProfile } from '../../core/storage';
import { TableService } from '../../core/table.service';
import { AvatarField } from '../../ui/avatar-field';
import { pickAvatar } from '../../ui/avatar-presets';
import { BackIcon } from '../../ui/back-icon';

const BUY_IN_PRESETS = [500, 1000, 2000, 5000];

@Component({
  selector: 'app-create-page',
  imports: [FormsModule, RouterLink, MoneyPipe, BackIcon, AvatarField],
  template: `
    <main class="page">
      <header class="flex h-16 items-center">
        <a routerLink="/" class="icon-btn" aria-label="Volver"><app-back-icon /></a>
      </header>

      <h1 class="mb-8 text-3xl font-extralight">Nueva mesa</h1>

      <form class="flex flex-1 flex-col gap-6 pb-10" (ngSubmit)="submit()">
        <div>
          <label class="label" for="nickname">Tú</label>
          <div class="flex items-center gap-3">
            <app-avatar-field [(value)]="avatar" />
            <input class="field" id="nickname" name="nickname" [(ngModel)]="nickname" [maxlength]="limits.maxNickname"
                   autocomplete="nickname" placeholder="Cómo te verán en la mesa" />
          </div>
        </div>

        <label>
          <span class="label">Clave de la mesa</span>
          <input class="field" name="password" [(ngModel)]="password" [maxlength]="limits.maxPassword"
                 autocomplete="off" spellcheck="false" placeholder="Mínimo {{ limits.minPassword }} caracteres" />
          <span class="hint">La necesitarán tus amigos para sentarse.</span>
        </label>

        <div>
          <span class="label">Jugadores</span>
          <div class="flex h-14 items-center justify-between rounded-2xl bg-surface px-2">
            <button type="button" class="icon-btn !ml-0 text-2xl font-light" aria-label="Menos jugadores"
                    [disabled]="players() <= limits.minPlayers" (click)="players.set(players() - 1)">−</button>
            <span class="text-xl font-light tabular-nums">{{ players() }}</span>
            <button type="button" class="icon-btn !ml-0 text-2xl font-light" aria-label="Más jugadores"
                    [disabled]="players() >= limits.maxPlayers" (click)="players.set(players() + 1)">+</button>
          </div>
        </div>

        <div>
          <span class="label">Entrada</span>
          <div class="grid grid-cols-4 gap-2">
            @for (preset of presets; track preset) {
              <button type="button" class="btn btn-sm" [class.btn-primary]="buyIn() === preset"
                      [attr.aria-pressed]="buyIn() === preset" (click)="buyIn.set(preset)">
                {{ preset | money: 'short' }}
              </button>
            }
          </div>
          <span class="hint">
            Ciegas iniciales {{ blinds().sb | money }} / {{ blinds().bb | money }}, suben cada 10 minutos.
          </span>
        </div>

        <div class="mt-auto flex flex-col gap-3">
          @if (error(); as message) {
            <p class="text-center text-sm text-suit-red">{{ message }}</p>
          }
          <button class="btn btn-primary" type="submit" [disabled]="!valid() || pending()">
            {{ pending() ? 'Creando…' : 'Crear mesa' }}
          </button>
        </div>
      </form>
    </main>
  `,
})
export class CreatePage {
  private readonly router = inject(Router);
  private readonly table = inject(TableService);

  protected readonly limits = LIMITS;
  protected readonly presets = BUY_IN_PRESETS;

  private readonly profile = loadProfile();
  protected readonly nickname = signal(this.profile?.nickname ?? '');
  protected readonly avatar = signal(pickAvatar(this.profile?.avatar, []));
  protected readonly password = signal('');
  protected readonly players = signal(6);
  protected readonly buyIn = signal(1000);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly blinds = computed(() => standardBlindStructure(this.buyIn()).levels[0]!);
  protected readonly valid = computed(
    () => this.nickname().trim().length > 0 && this.password().length >= LIMITS.minPassword,
  );

  protected async submit(): Promise<void> {
    if (!this.valid() || this.pending()) return;
    this.pending.set(true);
    this.error.set(null);

    const profile = { nickname: this.nickname().trim(), avatar: this.avatar() };
    const result = await this.table.create({
      ...profile,
      password: this.password(),
      maxPlayers: this.players(),
      buyIn: this.buyIn(),
    });

    this.pending.set(false);
    if (!result.ok) {
      this.error.set(errorMessage(result.error));
      return;
    }
    saveProfile(profile);
    rememberPassword(result.tableId, this.password());
    void this.router.navigate(['/mesa', result.tableId]);
  }
}
