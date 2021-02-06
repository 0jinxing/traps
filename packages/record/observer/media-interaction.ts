import { on } from '../utils';
import { ExtNode, mirror } from '@mood/snapshot';
import { IncrementalSource } from '../constant';

export type MediaInteraction = 'play' | 'pause';

export type MediaInteractionData = {
  source: IncrementalSource.MEDIA_INTERACTION;
  act: MediaInteraction;
  id: number;
};

export type MediaInteractionCb = (param: MediaInteractionData) => void;

export function mediaInteraction(cb: MediaInteractionCb) {
  const handler = (act: MediaInteraction) => (event: Event) => {
    const { target } = event;
    if (target) {
      cb({
        source: IncrementalSource.MEDIA_INTERACTION,
        id: mirror.getId(target as ExtNode),
        act
      });
    }
  };
  const handlers = [on('play', handler('play')), on('pause', handler('pause'))];
  return () => {
    handlers.forEach(h => h());
  };
}
