import { createFactory } from '../../ui/yeet/factory.js';
import swamp from '../swamp/scene.js';
import motorCourt from './factory.js';

export default {
  ...swamp,
  factory: (container, options) => createFactory(container, motorCourt, options),
};
