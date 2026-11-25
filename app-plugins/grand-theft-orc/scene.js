import { createFactory } from '../../ui/yeet/factory.js';
import swamp from '../swamp/scene.js';
import motorCourt from './factory.js';
import { driveAway, openEnvelope } from './send-offs.js';

// The actors carry the delivery cue inside the picture.
const look = { ...swamp.look, words: { ...swamp.look.words, pr: '', yeet: '' } };

export default {
  ...swamp,
  look,
  pr: openEnvelope, yeet: driveAway,
  factory: (container, options) => createFactory(container, motorCourt, options),
};
