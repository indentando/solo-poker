import { Component, computed, effect, input, output, signal } from '@angular/core';
import type { Action, Cents, LegalActions } from '@solo-poker/engine';
import { MoneyPipe } from '../../core/format';

interface RaisePreset {
  label: string;
  to: Cents;
}

/**
 * Botones de acción del jugador en turno. La subida rápida usa el mínimo;
 * el botón ↑ abre el panel para elegir cantidad.
 */
@Component({
  selector: 'app-action-bar',
  imports: [MoneyPipe],
  template: `
    @if (legal(); as legal) {
      <div class="relative">
        <div class="timer" [class.urgent]="progress() < 0.25" [style.transform]="'scaleX(' + progress() + ')'"></div>

        @if (raiseOpen() && legal.raise; as raise) {
          <div class="flex flex-col gap-4 rounded-3xl border-[1.5px] border-line p-4" animate.enter="fade-enter">
            <div class="flex items-baseline justify-between">
              <span class="text-sm text-muted">{{ verb() }} to</span>
              <span class="text-3xl font-light tabular-nums">{{ raiseTo() | money }}</span>
            </div>
            <input type="range" class="slider" aria-label="Cantidad"
                   [min]="raise.min" [max]="raise.max" step="1" [value]="raiseTo()"
                   (input)="setRaiseTo($any($event.target).valueAsNumber)" />
            <div class="grid grid-cols-4 gap-2">
              @for (preset of presets(); track preset.label) {
                <button class="btn btn-sm !px-1" [class.btn-primary]="raiseTo() === preset.to"
                        (click)="setRaiseTo(preset.to)">{{ preset.label }}</button>
              }
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button class="btn" (click)="raiseOpen.set(false)">Cancelar</button>
              <button class="btn btn-primary" [disabled]="pending()" (click)="send({ type: 'raise', to: raiseTo() })">
                {{ raiseTo() === raise.max ? 'All-in' : verb() }} {{ raiseTo() | money: 'plain' }}
              </button>
            </div>
          </div>
        } @else {
          <div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <button class="btn" [disabled]="pending()" (click)="send({ type: 'fold' })">Fold</button>

            @if (legal.canCheck) {
              <button class="btn" [disabled]="pending()" (click)="send({ type: 'check' })">Check</button>
            } @else {
              <button class="btn" [disabled]="pending()" (click)="send({ type: 'call' })">
                {{ legal.callAmount === stack() ? 'All-in' : 'Call' }} {{ legal.callAmount | money: 'plain' }}
              </button>
            }

            @if (legal.raise; as raise) {
              <button class="btn" [disabled]="pending()" (click)="send({ type: 'raise', to: raise.min })">
                {{ raise.min === raise.max ? 'All-in' : verb() }} {{ raise.min | money: 'plain' }}
              </button>
              <button class="btn aspect-square !px-0" aria-label="Elegir cantidad"
                      [disabled]="pending() || raise.min === raise.max" (click)="openRaise(raise.min)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            } @else {
              <div class="col-span-2"></div>
            }
          </div>
        }
      </div>
    } @else {
      <div class="flex h-14 items-center justify-center text-center text-muted">{{ idleText() }}</div>
    }
  `,
  styles: `
    .timer {
      position: absolute;
      top: -0.75rem;
      left: 0;
      height: 2px;
      width: 100%;
      transform-origin: left;
      border-radius: 1px;
      background: #fff;
      transition: transform 250ms linear;
    }
    .timer.urgent {
      background: var(--color-suit-red);
    }
    .slider {
      width: 100%;
      accent-color: #fff;
    }
  `,
})
export class ActionBar {
  /** null cuando no es tu turno. */
  readonly legal = input<LegalActions | null>(null);
  readonly stack = input(0);
  readonly potTotal = input(0);
  /** Apuesta más alta de la calle: decide entre "Bet" y "Raise". */
  readonly currentBet = input(0);
  /** Tiempo de turno restante (1 → 0). */
  readonly progress = input(1);
  readonly pending = input(false);
  readonly idleText = input('');
  readonly act = output<Action>();

  protected readonly raiseOpen = signal(false);
  protected readonly raiseTo = signal(0);

  protected readonly verb = computed(() => (this.currentBet() > 0 ? 'Raise' : 'Bet'));

  /** Atajos clásicos: mínimo, medio bote, bote y all-in (ajustados al rango legal). */
  protected readonly presets = computed<RaisePreset[]>(() => {
    const raise = this.legal()?.raise;
    if (!raise) return [];
    const toCall = this.legal()!.callAmount;
    // Subir "al bote": igualar y después apostar todo lo que habría en el bote.
    const potRaise = (fraction: number) =>
      this.clamp(Math.round(this.currentBet() + (this.potTotal() + toCall) * fraction));
    return [
      { label: 'Min', to: raise.min },
      { label: '½ Pot', to: potRaise(0.5) },
      { label: 'Pot', to: potRaise(1) },
      { label: 'All-in', to: raise.max },
    ];
  });

  constructor() {
    // Si se acaba el turno con el panel abierto, se cierra.
    effect(() => {
      if (!this.legal()?.raise) this.raiseOpen.set(false);
    });
  }

  protected openRaise(min: Cents): void {
    this.raiseTo.set(min);
    this.raiseOpen.set(true);
  }

  protected setRaiseTo(value: number): void {
    if (Number.isFinite(value)) this.raiseTo.set(this.clamp(value));
  }

  protected send(action: Action): void {
    this.raiseOpen.set(false);
    this.act.emit(action);
  }

  private clamp(value: number): Cents {
    const raise = this.legal()?.raise;
    if (!raise) return value;
    return Math.min(raise.max, Math.max(raise.min, Math.round(value)));
  }
}
