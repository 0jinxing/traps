import * as mittProxy from 'mitt';
import type { MittStatic, Handler } from 'mitt';

import rebuild, { buildNodeWithSN } from '@mood/snapshot/rebuild';
import { mirror } from '@mood/snapshot';
import { TEventWithTime, FullSnapshotEvent } from '@mood/record';
import Timer from './timer';
import createReplayerService from './fsm';
import getInjectStyle from './styles/inject-style';

import {
  EventType,
  IncrementalSource,
  MouseInteractions
} from '@mood/record/constant';
import { AddedNodeMutation } from '@mood/record/observer/mutation';
import { ViewportResizeCbParam } from '@mood/record/observer/viewport-resize';

import { ActionWithDelay } from './types';

import './styles/index.css';

const mitt: MittStatic = (mittProxy as any).default || mittProxy;

const {
  MUTATION,
  MOUSE_MOVE,
  MOUSE_INTERACTION,
  SCROLL,
  VIEWPORT_RESIZE,
  INPUT,
  TOUCH_MOVE,
  MEDIA_INTERACTION,
  STYLE_SHEETRULE
  // LOG,
  // REQUEST_XHR,
  // REQUEST_FETCH,
  // GLOBAL_ERROR
} = IncrementalSource;

export type PlayerConfig = {
  speed: number;
  root: HTMLElement;
  insertStyleRules: string[];
};

export type PlayerMetaData = {
  totalTime: number;
};

export type PlayerEmitterEvent =
  | 'start'
  | 'pause'
  | 'resume'
  | 'resize'
  | 'finish'
  | 'fullsnapshot_rebuilded'
  | 'load_stylesheet_start'
  | 'load_stylesheet_end'
  | 'skip_start'
  | 'skip_end'
  | 'mouse_interaction'
  | 'event_cast';

const defaultConfig: PlayerConfig = {
  speed: 1,
  root: document.body,
  insertStyleRules: []
};

class Player {
  private $iframe: HTMLIFrameElement;

  private $wrapper: HTMLElement;
  private $cursor: HTMLElement;

  private emitter = mitt();
  private timer = new Timer();

  private baselineTime = 0;
  private lastPlayedEvent: TEventWithTime;
  private service!: ReturnType<typeof createReplayerService>;

  private nextUserInteractionEvent: TEventWithTime | null = null;
  private config: PlayerConfig = defaultConfig;

  constructor(
    private events: TEventWithTime[],
    config: Partial<PlayerConfig> = {}
  ) {
    this.setConfig(config);

    this.service = createReplayerService({
      events,
      timeOffset: 0,
      speed: this.config.speed
    });

    this.setupDOM();
    this.service.start();

    const resizeHandler = this.handleResize.bind(this);
    this.on('resize', resizeHandler);
  }

  public on(type: PlayerEmitterEvent | '*', handler: Handler) {
    this.emitter.on(type, handler);
  }

  private emit(type: PlayerEmitterEvent | '*', event?: unknown) {
    this.emitter.emit(type, event);
  }

  private setupDOM() {
    this.$wrapper = document.createElement('div');
    this.$wrapper.classList.add('__wrapper');

    this.$cursor = document.createElement('div');
    this.$cursor.classList.add('__cursor');

    this.$iframe = document.createElement('iframe');
    this.$iframe.setAttribute('sandbox', 'allow-same-origin');
    this.$iframe.setAttribute('scrolling', 'no');
    this.$iframe.setAttribute('style', 'pointer-events: none');

    this.$wrapper.appendChild(this.$iframe);
    this.$wrapper.appendChild(this.$cursor);

    this.config.root.appendChild(this.$wrapper);
  }

  private setConfig(config: Partial<PlayerConfig>) {
    this.config = Object.assign({}, this.config, config);
    this.timer.setSpeed(this.config.speed);
  }

  private handleResize(dimension: ViewportResizeCbParam) {
    this.$iframe.width = `${dimension.width}px`;
    this.$iframe.height = `${dimension.height}px`;
  }

  private getTimeOffset(): number {
    return this.baselineTime - this.events[0].timestamp;
  }

  private getDelay(event: TEventWithTime): number {
    if (
      event.type === EventType.INCREMENTAL_SNAPSHOT &&
      (event.data.source === MOUSE_MOVE || event.data.source === TOUCH_MOVE)
    ) {
      const firstOffset = event.data.positions[0].timeOffset;
      const firstTimestamp = event.timestamp + firstOffset;
      return firstTimestamp - this.baselineTime;
    }
    return event.timestamp - this.baselineTime;
  }

  private moveAndHover(x: number, y: number, id: number) {
    this.$cursor.style.left = `${x}px`;
    this.$cursor.style.top = `${y}px`;
    const $target = mirror.getNode<Element>(id);

    if ($target) {
      this.hoverElement($target);
    }
  }

  private hoverElement($el: Element) {
    this.$iframe.contentDocument
      ?.querySelectorAll('.\\:hover')
      .forEach($hovered => {
        $hovered.classList.remove(':hover');
      });

    let $current: Element | null = $el;
    while ($current) {
      if ($current.classList) {
        $current.classList.add(':hover');
      }
      $current = $current.parentElement;
    }
  }

  private applyIncremental(
    event: TEventWithTime & { type: EventType.INCREMENTAL_SNAPSHOT },
    isSync: boolean
  ) {
    const { data, timestamp } = event;

    switch (data.source) {
      case MUTATION: {
        data.removes.forEach(rm => {
          const $el = mirror.getNode(rm.id);
          const $parent = mirror.getNode(rm.parentId);
          if (!$el) {
            return;
          }
          mirror.remove($el);
          if ($parent) {
            $parent.removeChild($el);
          }
        });

        const addedQueue: AddedNodeMutation[] = [];

        const appendNode = (add: AddedNodeMutation) => {
          const $parent = add.parentId
            ? mirror.getNode(add.parentId)
            : undefined;

          if (!$parent) {
            addedQueue.push(add);
            return;
          }

          let $next: Node | undefined;

          if (add.nextId) {
            $next = mirror.getNode(add.nextId);
          }

          if (add.nextId && !$next) {
            addedQueue.push(add);
            return;
          }

          const $target = buildNodeWithSN(
            add.node,
            this.$iframe.contentDocument!
          );

          if ($next && $next.parentElement) {
            // making sure the parent contains the reference nodes
            // before we insert target before next.
            $parent.contains($next)
              ? $parent.insertBefore($target!, $next)
              : $parent.insertBefore($target!, null);
          } else {
            $parent.appendChild($target!);
          }
        };

        data.adds.forEach(add => {
          appendNode(add);
        });

        while (addedQueue.length) {
          if (
            addedQueue.every(m => !m.parentId || !mirror.getNode(m.parentId))
          ) {
            return;
          }

          const mutation = addedQueue.shift()!;
          appendNode(mutation);
        }

        data.texts.forEach(mutation => {
          const $target = mirror.getNode(mutation.id);
          if (!$target) {
            return;
          }
          $target.textContent = mutation.value;
        });

        data.attributes.forEach(mutation => {
          const $target = mirror.getNode<Element>(mutation.id);
          if (!$target) {
            return;
          }
          for (const attributeName in mutation.attributes) {
            const value = mutation.attributes[attributeName];
            if (value) {
              $target.setAttribute(attributeName, value + '');
            } else {
              $target.removeAttribute(attributeName);
            }
          }
        });
        break;
      }

      case MOUSE_MOVE: {
        if (isSync) {
          const lastPosition = data.positions[data.positions.length - 1];
          this.moveAndHover(lastPosition.x, lastPosition.y, lastPosition.id);
        } else {
          data.positions.forEach(mutation => {
            const action = {
              doAction: () => {
                this.moveAndHover(mutation.x, mutation.y, mutation.id);
              },
              delay: mutation.timeOffset + timestamp - this.baselineTime
            };
            this.timer.addAction(action);
          });
        }
        break;
      }

      case MOUSE_INTERACTION: {
        const $target = mirror.getNode<HTMLElement>(data.id);
        if (!$target) break;

        const event = new Event(MouseInteractions[data.act]);

        this.emit('mouse_interaction', { type: data.act, $target });

        switch (data.act) {
          case MouseInteractions.blur: {
            // TODO
            break;
          }
          case MouseInteractions.focus: {
            // TODO
            break;
          }
          case MouseInteractions.click:
          case MouseInteractions.touchend:
          case MouseInteractions.touchstart: {
            if (!isSync) {
              this.moveAndHover(data.x, data.y, data.id);
              this.$cursor.classList.remove('active');
              setTimeout(() => {
                this.$cursor.classList.add('active');
              });
            }
            break;
          }
          default: {
            $target.dispatchEvent(event);
          }
        }
        break;
      }

      case SCROLL: {
        const $target = mirror.getNode<HTMLElement>(data.id);
        if (!$target) break;

        if (($target as Node) === this.$iframe.contentDocument) {
          this.$iframe.contentWindow!.scrollTo({
            top: data.y,
            left: data.x,
            behavior: isSync ? 'auto' : 'smooth'
          });
        } else {
          try {
            $target.scrollTop = data.y;
            $target.scrollLeft = data.x;
          } catch (err) {
            /**
             * Seldomly we may found scroll target was removed before
             * its last scroll event.
             */
          }
        }
        break;
      }

      case VIEWPORT_RESIZE: {
        this.emit('resize', { width: data.width, height: data.height });
        break;
      }

      case MEDIA_INTERACTION: {
        const $target = mirror.getNode<HTMLMediaElement>(data.id);
        if (!$target) break;

        if (data.act === 'play') {
          if ($target.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            $target.play();
          } else {
            $target.addEventListener('canplay', () => $target.play());
          }
        } else if (data.act === 'pause') {
          $target.pause();
        }
        break;
      }

      case INPUT: {
        const $target = mirror.getNode<HTMLInputElement>(data.id);

        if (!$target) break;

        if (typeof data.value === 'boolean') {
          $target.checked = data.value;
        } else {
          $target.value = data.value;
        }
        break;
      }

      case STYLE_SHEETRULE: {
        const $target = mirror.getNode<HTMLStyleElement>(data.id);
        if (!$target) break;

        const styleSheet = <CSSStyleSheet>$target.sheet;

        if (data.adds) {
          data.adds.forEach(({ rule, index }) => {
            const insertIndex =
              index === undefined
                ? undefined
                : Math.min(index, styleSheet.rules.length);
            try {
              styleSheet.insertRule(rule, insertIndex);
            } catch (e) {
              /**
               * sometimes we may capture rules with browser prefix
               * insert rule with prefixs in other browsers may cause Error
               */
            }
          });
        }

        if (data.removes) {
          data.removes.forEach(({ index }) => styleSheet.deleteRule(index));
        }
        break;
      }
    }
  }

  private rebuildFullSnapshot(event: TEventWithTime & FullSnapshotEvent) {
    const contentDocument = this.$iframe.contentDocument!;

    rebuild(event.data.adds, contentDocument);

    const $style = document.createElement('style');
    const { documentElement, head } = contentDocument;
    documentElement.insertBefore($style, head);
    const injectStylesRules = getInjectStyle().concat(
      this.config.insertStyleRules
    );

    for (let ind = 0; ind < injectStylesRules.length && $style.sheet; ind++) {
      $style.sheet.insertRule(injectStylesRules[ind], ind);
    }

    this.emit('fullsnapshot_rebuilded');
  }

  private getCastFn(event: TEventWithTime, isSync = false) {
    let castFn: Function;
    switch (event.type) {
      case EventType.DOM_CONTENT_LOADED:
      case EventType.LOADED: {
        break;
      }
      case EventType.META: {
        castFn = () => {
          const { width, height } = event.data;
          this.emit('resize', { width, height });
        };
        break;
      }
      case EventType.FULL_SNAPSHOT: {
        castFn = () => {
          this.rebuildFullSnapshot(event);
          this.$iframe.contentWindow!.scrollTo(event.data.offset);
        };
        break;
      }
      case EventType.INCREMENTAL_SNAPSHOT: {
        castFn = () => {
          this.applyIncremental(event, isSync);
        };
        break;
      }
    }

    const wrappedCastFn = () => {
      if (castFn) {
        castFn();
      }

      this.lastPlayedEvent = event;
      if (event === this.events[this.events.length - 1]) {
        this.emit('finish');
      }
    };

    return wrappedCastFn;
  }

  public getMetaData(): PlayerMetaData {
    const firstEvent = this.events[0];
    const lastEvent = this.events[this.events.length - 1];
    return { totalTime: lastEvent.timestamp - firstEvent.timestamp };
  }

  public getCurrentTime(): number {
    return this.timer.timeOffset + this.getTimeOffset();
  }

  public pause() {
    this.timer.clear();
    this.service.send({ type: 'pause' });
    this.emit('pause');
  }

  public play(timeOffset = 0) {
    this.timer.clear();
    this.baselineTime = this.events[0].timestamp + timeOffset;
    const actions: ActionWithDelay[] = [];
    for (const event of this.events) {
      const isSync = event.timestamp < this.baselineTime;
      const castFn = this.getCastFn(event, isSync);
      if (isSync) castFn();
      else {
        actions.push({
          doAction: () => {
            castFn();
            this.emit('event_cast', event);
          },
          delay: this.getDelay(event)
        });
      }
    }
    this.timer.addActions(actions);
    this.timer.start();
    this.service.send({ type: 'play' });
    this.emit('start');
  }

  public resume(timeOffset = 0) {
    this.timer.clear();
    this.baselineTime = this.events[0].timestamp + timeOffset;
    const actions: ActionWithDelay[] = [];

    for (const event of this.events) {
      if (
        event.timestamp <= this.lastPlayedEvent.timestamp ||
        event === this.lastPlayedEvent
      ) {
        continue;
      }
      const castFn = this.getCastFn(event);
      actions.push({
        doAction: castFn,
        delay: this.getDelay(event)
      });
    }
    this.timer.addActions(actions);
    this.timer.start();
    this.service.send({ type: 'resume' });
    this.emit('resume');
  }
}

export default Player;